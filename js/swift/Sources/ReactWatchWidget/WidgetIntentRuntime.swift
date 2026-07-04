#if os(watchOS)
import CryptoKit
import Foundation
import ReactWatchCore
import ReactWatchRuntime
import ReactWatchSupport
import WidgetKit

/// Trusted OTA signer keys for the widget extension (NF-35). Set ONCE at
/// extension startup — from the widget bundle's `@main` init — with the SAME
/// `signerPublicKeys` the watch app passes to `ReactWatchRootView(ota:)`. Unlike
/// the App Group id (threaded per-call because a host can have two App Groups),
/// the signer keyset is one build-time constant, so a write-once global is
/// unambiguous. Critically these keys live in the code-signed extension binary,
/// NOT in the writable App Group — so `WidgetIntentRuntime` can re-verify a
/// known-good record the way the app does at boot. Without configuration (empty
/// keys, no dev opt-in) the widget can't authenticate an App-Group OTA record
/// and shows the shipped bundle — secure by default.
public enum ReactWatchWidgetOTA {
    nonisolated(unsafe) static var signerPublicKeys: [String: String] = [:]
    nonisolated(unsafe) static var allowUnsignedUpdates = false

    public static func configure(
        signerPublicKeys: [String: String] = [:],
        allowUnsignedUpdates: Bool = false
    ) {
        self.signerPublicKeys = signerPublicKeys
        self.allowUnsignedUpdates = allowUnsignedUpdates
    }
}

/// Short-lived QuickJS instance for the widget extension. Reuses the shared
/// `ReactWatchRuntime.JSRuntime` — the same engine embedding the watch app
/// uses, so there's one implementation, not two — evaluating the same bundle
/// with `__entrypoint = "intent"` so JS registers its widgets/intents but does
/// not mount UI. Used for:
///   - control AppIntents: `WidgetIntentRuntime.handle(intent:appGroupId:)`
///     dispatches to the React-registered handler, which mutates shared
///     Storage and republishes timelines;
///   - on-demand refresh: `renderFreshTimelines(appGroupId:)` recomputes
///     timelines while the app stays closed.
///
/// The App Group id is supplied by the consumer (the same one their watch app
/// passes to `ReactWatchRootView`) — no global state, so a host app with two
/// App Groups stays unambiguous.
///
/// Budget: widget extension processes get ~30MB; the engine + bundle measure
/// ~6MB peak (tools/embed-smoke), and the 16MB cap makes QuickJS fail loudly
/// long before the OS jetsams us.
/// NOTE: untested until built with Xcode on macOS (WidgetKit).
public final class WidgetIntentRuntime {
    private let js: JSRuntime
    private let store: SharedWidgetStore
    /// Cross-process-atomic counters (ARCH-05): the `addGlass` control runs
    /// here, in the extension, while the app may be incrementing the same
    /// counter.
    private let counters: CoordinatedCounterStore

    public init?(appGroupId: String) {
        store = SharedWidgetStore(appGroupId: appGroupId)
        counters = CoordinatedCounterStore(appGroupId: appGroupId)
        guard
            let js = try? JSRuntime(
                memoryLimitBytes: 16 * 1024 * 1024, target: .widget)
        else {
            return nil
        }
        self.js = js
        // Non-fatal JS errors (a throwing intent handler, a bad timeline render)
        // would otherwise vanish in the extension — surface them to the console.
        js.onError = { print("[react-watch-widget]", $0) }
        // The intent entrypoint must not mount UI; ignore any commit.
        js.bridge.commit = { _ in }
        // Intent-mode JS has NO timers: since M1's owning-queue confinement a
        // timer would fire safely (on the runtime's own queue), but this
        // runtime is discarded as soon as the render/intent pass returns, so
        // one could never usefully fire — refuse loudly instead of arming a
        // timer that silently evaporates.
        js.bridge.setTimer = { id, ms in
            print(
                "[react-watch-widget] setTimer(\(id), \(ms)) ignored — "
                    + "intent-mode JS has no timers")
        }
        js.bridge.clearTimer = { _ in }
        js.bridge.publishWidgets = { [store] json in
            store.save(json)
            WidgetIntentRuntime.invalidateCache()
            WidgetCenter.shared.reloadAllTimelines()
        }
        js.bridge.getItem = { [store] key in store.getItem(key) }
        js.bridge.setItem = { [store] key, value in store.setItem(key, value) }
        js.bridge.counterGet = { [counters] key in counters.value(forKey: key) }
        js.bridge.counterAdd = { [counters] key, delta, min, max in
            counters.add(delta, toKey: key, min: min, max: max)
        }
        do {
            try js.evaluate(
                "globalThis.__entrypoint = \"intent\"", filename: "entry.js"
            )
            installCapabilities()
            try loadBundle(appGroupId: appGroupId)
        } catch {
            return nil
        }
    }

    /// Exposes the widget target's capability set + bridge protocol to JS before
    /// the bundle runs (ARCH-01), mirroring the app's installHostCapabilities so
    /// the same JS gate logic sees a consistent host. HostFeatures.widget is the
    /// shared source of truth (the widget can't back fetch/ble/sensor/etc.).
    private func installCapabilities() {
        let features = HostFeatures.widget.sorted()
        let json =
            (try? JSONSerialization.data(withJSONObject: features))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
        try? js.evaluate(
            "globalThis.__hostFeatures=\(json);"
                + "globalThis.__bridgeProtocol=\(RNWire.bridgeProtocol);",
            filename: "host-capabilities.js"
        )
    }

    private func loadBundle(appGroupId: String) throws {
        // The bundle-selection rule (known-good over the unvetted active record;
        // pinned bytecode only when the hash matches; shipped when there's no
        // known-good) is the pure, Linux-tested WidgetBundleChoice. This shell
        // only does the App Group file I/O and the evaluate.
        let record = knownGoodRecord(appGroupId: appGroupId)
        let bytecode = knownGoodBytecode(appGroupId: appGroupId)
        let bytecodeHashMatches: Bool
        if let record, let bytecode {
            bytecodeHashMatches = record.bytecodeHash == ContentHash.of(bytecode)
        } else {
            bytecodeHashMatches = false
        }
        // NF-35 in the extension process: the known-good record lives in the
        // writable App Group, so re-verify its signature here (the app does the
        // same at boot) with keys baked into this signed extension. An unverified
        // record under enforcement degrades to the shipped bundle.
        let keys = ReactWatchWidgetOTA.signerPublicKeys
        let validKeyCount = keys.values.filter { decodeKey($0) != nil }.count
        let keyState = OTAKeyState.classify(
            configuredCount: keys.count, validCount: validKeyCount,
            allowUnsigned: ReactWatchWidgetOTA.allowUnsignedUpdates)
        let recordVerified = record.map { verifyRecord($0, keys: keys) } ?? false
        switch WidgetBundleChoice.decide(
            knownGood: record, bytecodeHashMatches: bytecodeHashMatches,
            keyState: keyState, recordVerified: recordVerified)
        {
        case .shipped:
            try loadShippedBundle()
        case .knownGoodBytecode:
            // decide returns this only when a hash-matching .good.qbc exists.
            guard let bytecode, let record else {
                try loadShippedBundle()
                return
            }
            do {
                try js.evaluateBytecode(bytecode)
            } catch {
                try js.evaluate(record.js)  // engine-version stale → parse source
            }
        case .knownGoodSource:
            guard let record else {
                try loadShippedBundle()
                return
            }
            try js.evaluate(record.js)
        }
    }

    /// Decodes a base64 raw Ed25519 public key, or nil if malformed (matching the
    /// app's key setup so OTAKeyState.classify sees the same valid count).
    private func decodeKey(_ base64: String) -> Curve25519.Signing.PublicKey? {
        Data(base64Encoded: base64)
            .flatMap { try? Curve25519.Signing.PublicKey(rawRepresentation: $0) }
    }

    /// Re-verifies a record's Ed25519 signature over its signedMessage — the same
    /// check as the app's boot re-verification (NF-35), so save-time, app-boot,
    /// and widget verification can never diverge. Includes the signed-expiry
    /// check (the revocation lever): a lapsed bundle degrades to shipped here
    /// too, not just in the app.
    private func verifyRecord(_ record: OTARecord, keys: [String: String]) -> Bool {
        guard let keyId = record.keyId, let base64 = keys[keyId],
            let key = decodeKey(base64),
            let sigB64 = record.signature,
            let signature = Data(base64Encoded: sigB64),
            let message = record.signedMessage()
        else { return false }
        if let expiresAt = record.expiresAt, expiresAt > 0,
            Date().timeIntervalSince1970 > Double(expiresAt)
        {
            return false
        }
        return key.isValidSignature(signature, for: message)
    }

    /// The last OTA record the app promoted as known-good, from the App Group.
    private func knownGoodRecord(appGroupId: String) -> OTARecord? {
        guard
            let url = OTAFiles.url(
                appGroupId: appGroupId, OTAFiles.knownGoodRecord),
            let data = try? Data(contentsOf: url)
        else { return nil }
        return try? JSONDecoder().decode(OTARecord.self, from: data)
    }

    /// The known-good record's pinned bytecode blob, from the App Group.
    private func knownGoodBytecode(appGroupId: String) -> Data? {
        guard
            let url = OTAFiles.url(
                appGroupId: appGroupId, OTAFiles.knownGoodBytecode)
        else { return nil }
        return try? Data(contentsOf: url)
    }

    private func loadShippedBundle() throws {
        // Prefer precompiled bytecode (faster cold start in the short-lived
        // extension), fall back to parsing bundle.js.
        if let qbc = Bundle.main.url(forResource: "bundle", withExtension: "qbc"),
            let data = try? Data(contentsOf: qbc)
        {
            do {
                try js.evaluateBytecode(data)
                return
            } catch {
                // fall through to source
            }
        }
        guard let url = Bundle.main.url(forResource: "bundle", withExtension: "js"),
            let code = try? String(contentsOf: url, encoding: .utf8)
        else {
            throw JSRuntime.JSError.exception("bundle missing — run `npm run build`")
        }
        try js.evaluate(code)
    }

    // MARK: - Public API

    /// Runs a React-registered intent handler in a fresh extension runtime.
    /// Handlers republish timelines themselves via __host.publishWidgets.
    @discardableResult
    public static func handle(intent name: String, appGroupId: String) -> Bool {
        guard let runtime = WidgetIntentRuntime(appGroupId: appGroupId) else {
            return false
        }
        return runtime.js.callReturningBool("__handleIntent", name)
    }

    /// Recomputes all timelines without going through publish. Persists the
    /// result so other widget kinds see it too. WidgetKit asks every
    /// kind/family in a burst, so a short-lived cache keeps one reload cycle to
    /// a single bundle evaluation.
    public static func renderFreshTimelines(
        appGroupId: String, now: Date = .now, maxAge: TimeInterval = 5
    ) -> PublishedWidgets? {
        // Fast path: a fresh-enough cached payload, read under the lock. The
        // epoch snapshot makes a concurrent invalidation detectable below.
        cacheLock.lock()
        if let cache = freshCache, now.timeIntervalSince(cache.date) < maxAge {
            let payload = cache.payload
            cacheLock.unlock()
            return payload
        }
        let startEpoch = cacheEpoch
        cacheLock.unlock()

        // Construct + evaluate OUTSIDE the lock (B3): init evaluates the whole
        // bundle with the publishWidgets closure already wired, and a bundle
        // that publishes during load re-enters invalidateCache — holding the
        // non-reentrant cacheLock across that was a deterministic same-thread
        // deadlock (extension watchdog-killed, complications frozen).
        guard let runtime = WidgetIntentRuntime(appGroupId: appGroupId) else {
            return nil
        }
        let ms = now.timeIntervalSince1970 * 1000
        guard let json = runtime.js.callReturningString("__renderWidgets", ms),
            let payload = try? JSONDecoder().decode(
                PublishedWidgets.self, from: Data(json.utf8)
            )
        else {
            return nil
        }
        // Persist + cache ONLY if nothing invalidated during the render: this
        // render evaluated against the Storage state it STARTED from, so if an
        // intent published meanwhile, writing our result would overwrite the
        // newer payload and re-populate the cache with pre-tap data — and the
        // intent's reloadAllTimelines would be consumed serving it. (The
        // pre-B3 whole-function lock gave this ordering implicitly; the epoch
        // restores it without re-introducing the deadlock.) The stale payload
        // is still returned for THIS request — the invalidator's reload
        // triggers a fresh provider pass right behind it. store.save under
        // the lock is safe: no publish path holds cacheLock while saving.
        cacheLock.lock()
        if cacheEpoch == startEpoch {
            runtime.store.save(json)
            freshCache = (now, payload)
        }
        cacheLock.unlock()
        return payload
    }

    private static let cacheLock = NSLock()
    // Guarded by cacheLock (a short-lived burst of timeline requests shares
    // one bundle eval); the lock is the synchronization, hence unsafe.
    nonisolated(unsafe) private static var freshCache: (date: Date, payload: PublishedWidgets)?
    /// Bumped by every invalidation (guarded by cacheLock) so an in-flight
    /// render can tell its result was superseded before it finished.
    nonisolated(unsafe) private static var cacheEpoch = 0

    /// Called when an intent handler publishes a newer payload.
    static func invalidateCache() {
        cacheLock.lock()
        freshCache = nil
        cacheEpoch += 1
        cacheLock.unlock()
    }
}
#endif
