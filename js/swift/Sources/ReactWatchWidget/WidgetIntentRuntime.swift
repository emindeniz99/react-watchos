#if os(watchOS)
import CryptoKit
import Foundation
import ReactWatchCore
import ReactWatchRuntime
import ReactWatchSupport
import WidgetKit
import os

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
    /// The consumer's HostPolicy for the extension (ARCH-07) — same write-once
    /// pattern as the signer keys, and normally the SAME policy the watch app
    /// passes to `ReactWatchRootView(policy:)`. Applied against
    /// `HostFeatures.widget`, so it can only narrow the widget's already-small
    /// surface ("core" always stays).
    nonisolated(unsafe) static var policy: HostPolicy = .allowAll

    public static func configure(
        signerPublicKeys: [String: String] = [:],
        allowUnsignedUpdates: Bool = false,
        policy: HostPolicy = .allowAll
    ) {
        self.signerPublicKeys = signerPublicKeys
        self.allowUnsignedUpdates = allowUnsignedUpdates
        self.policy = policy
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
    /// JS-error sink for the extension (filter subsystem
    /// `com.reactwatchos.widget`, category `js` in Console.app).
    private static let jsErrorLog = Logger(
        subsystem: "com.reactwatchos.widget", category: "js")

    private let js: JSRuntime
    private let store: SharedWidgetStore
    /// ARCH-13 diagnostics context for this short-lived runtime: a fresh
    /// session per creation (each render/intent pass is its own boot), the
    /// booted bundle's content hash when it is cheaply known, and the
    /// render-time budget. The extension has no push channel to the app, so
    /// breaches go to the default Logger sink.
    private let sessionId = UUID().uuidString
    private var bootedReleaseId: String?
    private var budgets = BudgetPolicy()
    private static let diagnosticsSink = LogDiagnosticsSink()
    /// Cross-process-atomic counters (ARCH-05): the `addGlass` control runs
    /// here, in the extension, while the app may be incrementing the same
    /// counter.
    private let counters: CoordinatedCounterStore
    /// The App-Group state revision (ARCH-06). Same primitive as `counters` in
    /// its own subdirectory; the extension mints it exactly like the app,
    /// because a control intent handled HERE is a committed mutation the app
    /// never saw.
    private let revision: CoordinatedCounterStore
    /// Batches the bump to one file claim per mutation batch (ARCH-06).
    private var revisionTracker = StateRevisionTracker()
    /// The ARCH-07 effective feature set for this extension:
    /// `HostFeatures.widget` filtered by `ReactWatchWidgetOTA.policy` ("core"
    /// always kept). Drives the install allowlist, the published
    /// `__hostFeatures`, and the invoke rejection below.
    private let effectiveFeatures: Set<String>

    public init?(appGroupId: String) {
        store = SharedWidgetStore(appGroupId: appGroupId)
        counters = CoordinatedCounterStore(appGroupId: appGroupId)
        revision = CoordinatedCounterStore(
            appGroupId: appGroupId,
            subdirectory: StateRevisionTracker.subdirectory)
        let effectiveFeatures = ReactWatchWidgetOTA.policy.effectiveFeatures(
            native: HostFeatures.widget)
        self.effectiveFeatures = effectiveFeatures
        guard
            let js = try? JSRuntime(
                memoryLimitBytes: 16 * 1024 * 1024, target: .widget,
                allowedFeatures: effectiveFeatures)
        else {
            return nil
        }
        self.js = js
        // Non-fatal JS errors (a throwing intent handler, a bad timeline render)
        // would otherwise vanish in the extension — surface them through
        // os.Logger (non-blocking, visible in Console.app/sysdiagnose in
        // RELEASE too, unlike the old bare print). Persisting a last-N ring in
        // the App Group was considered and skipped: SharedWidgetStore is a
        // plain key-value wrapper, and an append would be a cross-process
        // read-modify-write — the exact lost-update shape ARCH-05 exists for.
        js.onError = { source, message in
            Self.jsErrorLog.error(
                "js error (\(source, privacy: .public)): \(message, privacy: .public)"
            )
        }
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
        js.bridge.publishWidgets = { [weak self, store] json in
            // Read what the store holds before overwriting it — same reload
            // gate as the app host (ARCH-06 follow-up 3).
            let previous = store.publishedWidgetsJSON()
            store.save(json)
            // The payload carries the revision it was rendered against, so the
            // batch is closed: the next mutation must move past it (ARCH-06).
            // Unconditional — it is about what was STORED, not about the wake.
            self?.revisionTracker.closeBatch()
            // An intent that touched Storage without changing what any widget
            // renders (a no-op tap, a re-entrant republish) republishes an
            // identical payload; waking every timeline for it burns the refresh
            // budget for nothing. Skipping `invalidateCache()` with it is
            // deliberate and safe: the burst cache and the epoch exist to stop
            // a render from serving/overwriting payloads that describe DIFFERENT
            // state, and by construction here they describe the same state.
            guard
                WidgetPublishGate.shouldReload(previousJSON: previous, newJSON: json)
            else { return }
            WidgetIntentRuntime.invalidateCache()
            WidgetCenter.shared.reloadAllTimelines()
        }
        js.bridge.getItem = { [store] key in store.getItem(key) }
        js.bridge.setItem = { [weak self, store] key, value in
            self?.noteStateWrite()
            store.setItem(key, value)
        }
        js.bridge.counterGet = { [counters] key in counters.value(forKey: key) }
        js.bridge.counterAdd = { [weak self, counters] key, delta, min, max in
            self?.noteStateWrite()
            return counters.add(delta, toKey: key, min: min, max: max)
        }
        js.bridge.stateRevision = { [weak self, revision] in
            // A read means a payload is being STAMPED against this value, so
            // the batch normally closes here: a write landing after the sample
            // must move the revision past the stamp, or the payload would
            // certify state it was computed before (ARCH-06 — same rule as the
            // app host).
            //
            // EXCEPT on a render-only pass, where the payload about to be
            // stamped OWNS any write its own `render()` callbacks make. There
            // the sample CONSUMES the batch slot instead: this runtime is built
            // per render and its tracker starts armed, so closing here would
            // guarantee the write bumps past the stamp the payload already
            // carries — leaving it stale the instant it is saved and booting
            // QuickJS again on the very next timeline request, forever.
            if self?.renderOnlyPass == true {
                self?.renderOnlyPass = false
                _ = self?.revisionTracker.needsBump()
            } else {
                self?.revisionTracker.closeBatch()
            }
            return revision.value(forKey: StateRevisionTracker.key)
        }
        // The widget backs NO invoke-routed method, and it used to leave
        // bridge.invoke unset — so any invoke call from widget-mode JS hung
        // until the 30s JS watchdog. Reject FAST and TYPED instead (ARCH-07
        // acceptance: widget/OTA runtimes cannot call undeclared app
        // capabilities): unknown method → UNKNOWN_METHOD; feature the widget
        // target doesn't provide → UNAVAILABLE; provided but policy-blocked →
        // POLICY_DENIED; provided and allowed → still UNAVAILABLE (nothing
        // backs invoke in this extension today — that branch is unreachable
        // until a schema invoke method targets the widget). `[weak js]`
        // because bridge.invoke lives on js itself (no retain cycle); the
        // synchronous re-entrant settle is the same M2-safe pattern the app's
        // UNKNOWN_METHOD rejection uses.
        js.bridge.invoke = { [weak js] id, method, _ in
            guard let js else { return }
            let code: InvokeErrorCode
            let message: String
            if let feature = HostInvokeFeatures.byMethod[method] {
                if !HostFeatures.widget.contains(feature) {
                    code = .unavailable
                    message =
                        "method '\(method)' is not available in the widget runtime"
                } else if !effectiveFeatures.contains(feature) {
                    code = .policyDenied
                    message =
                        "method '\(method)' is blocked by this app's host policy "
                        + "— requires an app configuration change"
                } else {
                    code = .unavailable
                    message =
                        "method '\(method)' has no native backing in the widget "
                        + "runtime"
                }
            } else {
                code = .unknownMethod
                message = "no invoke handler for \(method)"
            }
            js.rejectInvoke(
                id: id,
                errorJson: InvokeErrorJSON.make(code: code, message: message))
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

    /// ARCH-08 §3.E: this runtime owns a PRIVATE queue (`react.watch.widget-js`)
    /// and is created and driven from whatever WidgetKit provider/intent thread
    /// happens to be running, so the thread that drops the last reference is
    /// almost never the owning queue. Freeing the QuickJS heap from there is a
    /// race against anything still scheduled on that queue. `shutdown()` hops
    /// onto it and is idempotent, so JSRuntime's own deinit then has nothing
    /// left to do.
    deinit {
        js.shutdown()
    }

    /// Exposes the widget target's capability set + bridge protocol to JS before
    /// the bundle runs (ARCH-01), mirroring the app's installHostCapabilities so
    /// the same JS gate logic sees a consistent host. Publishes the EFFECTIVE
    /// set (ARCH-07): HostFeatures.widget — the shared source of truth for what
    /// the widget can back (no fetch/ble/sensor/etc.) — filtered by the policy.
    private func installCapabilities() {
        let features = effectiveFeatures.sorted()
        let json =
            (try? JSONSerialization.data(withJSONObject: features))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
        try? js.evaluate(
            "globalThis.__hostFeatures=\(json);"
                + "globalThis.__bridgeProtocol=\(RNWire.bridgeProtocol);"
                // The app publishes its deep-link scheme into the App Group (the
                // widget's own Bundle.main has no CFBundleURLTypes), so widget
                // timeline `url`s built via deepLinkURL match what the app parses.
                // Empty until the app has run once → JS keeps its default.
                + HostURLScheme.inject(store.urlScheme()),
            filename: "host-capabilities.js"
        )
    }

    /// Moves the App-Group state revision for the first write of this mutation
    /// batch (ARCH-06). Mirrors the app host, including the ordering: this runs
    /// BEFORE the write lands, so a crash between the two leaves the revision
    /// AHEAD of the data and the payload reads stale (safe) rather than
    /// current-but-wrong. Never reorder it after the store call.
    private func noteStateWrite() {
        guard revisionTracker.needsBump() else { return }
        revision.add(1, toKey: StateRevisionTracker.key, min: 0, max: .max)
    }

    /// One-shot: the next `stateRevision` sample belongs to a render-only pass
    /// (`__renderWidgets`), not to a publication. Set by `renderFreshTimelines`;
    /// consumed by the `stateRevision` bridge closure above.
    ///
    /// Deliberately NOT set in `init`: the intent path (`handle(intent:)`) runs
    /// a handler whose Storage write is a committed mutation the app never saw,
    /// and that write MUST bump.
    private var renderOnlyPass = false

    /// Marks the render about to run as render-only, so its `render()`-time
    /// Storage writes fold into the batch the payload it produces belongs to
    /// instead of moving the revision past that payload's stamp.
    ///
    /// Without this, a bundle whose `render()` writes Storage (a cached value, a
    /// last-render timestamp — a pattern the library's own tests register) makes
    /// every timeline request find `.staleRevision` and boot the engine again:
    /// a full QuickJS boot plus bundle eval per WidgetKit request, indefinitely,
    /// which the code calls the extension's dominant avoidable cost. Sampling
    /// after the render instead would re-introduce the exact ARCH-06 bug
    /// (certifying state the payload never read).
    private func armRenderOnlyBatch() {
        renderOnlyPass = true
    }

    /// Records the content id of the bundle this runtime is about to evaluate
    /// and exposes it to JS as `globalThis.__bundleReleaseId` — the same
    /// contract the app host has had since CX-025, which the extension was
    /// missing entirely. Without it every payload the extension published was
    /// stamped "producer unknown", and a payload the APP produced from a
    /// different (e.g. unproven-OTA) bundle could not be told apart from one of
    /// ours (ARCH-06).
    ///
    /// Also persisted to the App Group so a TimelineProvider — which has no
    /// runtime and must not boot one to decide whether to boot one — can name
    /// the release it reads with.
    private func setBundleReleaseId(_ source: String) {
        let releaseId = ContentHash.of(source)
        bootedReleaseId = releaseId
        store.saveWidgetReleaseId(releaseId)
        try? js.evaluate(
            "globalThis.__bundleReleaseId='\(releaseId)';",
            filename: "release-id.js")
    }

    private func loadBundle(appGroupId: String) throws {
        // ARCH-08 note (checked when the app host's OTA→shipped fallback was
        // moved onto a fresh runtime): this extension does NOT have the same
        // same-context reuse, and deliberately needs no equivalent change. A
        // `WidgetIntentRuntime` owns exactly one JSRuntime built in `init?`, and
        // a bundle that throws here fails the whole initialiser (`return nil`)
        // — the runtime is discarded and `deinit` shuts it down, so there is no
        // path that evaluates a DIFFERENT bundle into a context a failed one
        // touched. In particular a failed known-good OTA bundle does not fall
        // back to shipped in place; the caller gets nil and builds a new
        // runtime from scratch on the next request. The two bytecode→source
        // retries below (and in `loadShippedBundle`) re-evaluate the SAME
        // bundle, exactly like the app host's, and their residue dies with the
        // runtime moments later either way.
        //
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
            // Observability (review §6.11b): the widget process has no invoke
            // channel, so its bundle identity is logged — visible in Console/
            // sysdiagnose when diagnosing a fleet's complication spread.
            print("[react-watch-widget] bundle: shipped")
            try loadShippedBundle()
        case .knownGoodBytecode:
            // decide returns this only when a hash-matching .good.qbc exists.
            guard let bytecode, let record else {
                try loadShippedBundle()
                return
            }
            logBundleIdentity(record)
            setBundleReleaseId(record.js)
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
            logBundleIdentity(record)
            setBundleReleaseId(record.js)
            try js.evaluate(record.js)
        }
    }

    /// One line of OTA identity per runtime creation (review §6.11b): which
    /// known-good bundle this widget renders, matchable against the app's
    /// getUpdateState() in fleet logs.
    private func logBundleIdentity(_ record: OTARecord) {
        let version = record.version.map(String.init) ?? "unsigned"
        let keyId = record.keyId ?? "-"
        print(
            "[react-watch-widget] bundle: known-good OTA "
                + "version=\(version) keyId=\(keyId)")
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
        // Read the source up front for the release id (ARCH-06), even when the
        // precompiled bytecode runs below — exactly what the app host does at
        // loadShipped. This path used to return from the bytecode branch with
        // no release id at all, so a shipped-bytecode extension published
        // "producer unknown" payloads AND could not recognise a payload the app
        // had produced from an unproven OTA bundle as foreign. That is the one
        // configuration where the app and the extension genuinely run different
        // releases, so it is the one that most needs the id.
        let source = Bundle.main.url(forResource: "bundle", withExtension: "js")
            .flatMap { try? String(contentsOf: $0, encoding: .utf8) }
        if let source { setBundleReleaseId(source) }

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
        guard let code = source else {
            throw JSRuntime.JSError.exception("bundle missing — run `npm run build`")
        }
        try js.evaluate(code)
    }

    /// ARCH-13 widget render-time budget: WARN via the Logger sink when one
    /// timeline render pass overruns maxWidgetRenderMs — the early signal
    /// before the WidgetKit watchdog (or the 30 MB Jetsam wall) makes the
    /// overrun a silent extension kill.
    private func checkRenderBudget(elapsedMs: Double) {
        for diagnostic in budgets.check(
            widgetRenderMs: elapsedMs, sessionId: sessionId,
            releaseId: bootedReleaseId, target: .widget)
        {
            Self.diagnosticsSink.emit(diagnostic)
        }
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
        // Fast path: a fresh-enough cached payload FOR THIS APP GROUP, read
        // under the lock (a host with two groups must not be served the other
        // group's render within the freshness window). The epoch snapshot
        // makes a concurrent invalidation detectable below.
        cacheLock.lock()
        if let cache = freshCache[appGroupId],
            now.timeIntervalSince(cache.date) < maxAge
        {
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
        let renderStart = DispatchTime.now()
        runtime.armRenderOnlyBatch()
        let rendered = runtime.js.callReturningString("__renderWidgets", ms)
        runtime.checkRenderBudget(
            elapsedMs: Double(
                DispatchTime.now().uptimeNanoseconds
                    - renderStart.uptimeNanoseconds) / 1_000_000)
        guard let json = rendered,
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
            freshCache[appGroupId] = (now, payload)
        }
        cacheLock.unlock()
        return payload
    }

    private static let cacheLock = NSLock()
    // Guarded by cacheLock (a short-lived burst of timeline requests shares
    // one bundle eval); the lock is the synchronization, hence unsafe. Keyed
    // by App Group id — the render is per-group state.
    nonisolated(unsafe) private static var freshCache:
        [String: (date: Date, payload: PublishedWidgets)] = [:]
    /// Bumped by every invalidation (guarded by cacheLock) so an in-flight
    /// render can tell its result was superseded before it finished.
    nonisolated(unsafe) private static var cacheEpoch = 0

    /// The payload this process rendered most recently for `appGroupId`, if the
    /// burst cache still holds one. Lets `reactSnapshotEntry` — which must not
    /// render — pick between it and the stored payload with the same ordering
    /// rule the timeline path uses, instead of re-decoding the store.
    static func cachedPayload(appGroupId: String) -> PublishedWidgets? {
        cacheLock.lock()
        defer { cacheLock.unlock() }
        return freshCache[appGroupId]?.payload
    }

    /// Called when an intent handler publishes a newer payload.
    static func invalidateCache() {
        cacheLock.lock()
        freshCache.removeAll()
        cacheEpoch += 1
        cacheLock.unlock()
    }
}
#endif
