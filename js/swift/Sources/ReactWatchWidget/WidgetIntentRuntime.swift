#if os(watchOS)
import Foundation
import ReactWatchCore
import ReactWatchRuntime
import ReactWatchSupport
import WidgetKit

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
        // Render the SAME bundle the app last booted healthily: the known-good
        // OTA record (which the app promotes on its first healthy commit), else
        // the shipped bundle. Never the unvetted *active* OTA — the app's
        // crash-loop guard may not have cleared it yet, and a bundle that bricks
        // the extension would brick the complication on every refresh.
        if let record = knownGoodRecord(appGroupId: appGroupId),
            !record.js.isEmpty
        {
            try evaluateKnownGood(record, appGroupId: appGroupId)
            return
        }
        try loadShippedBundle()
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

    /// Run the known-good OTA bundle, preferring its pinned bytecode (faster cold
    /// start in the short-lived extension) and falling back to the source when
    /// it's missing or hash-stale — the same trust rule the app uses (OP-1).
    private func evaluateKnownGood(_ record: OTARecord, appGroupId: String) throws {
        if let url = OTAFiles.url(
            appGroupId: appGroupId, OTAFiles.knownGoodBytecode),
            let data = try? Data(contentsOf: url),
            record.bytecodeHash == ContentHash.of(data)
        {
            do {
                try js.evaluateBytecode(data)
                return
            } catch {
                // engine-version stale → parse the source below
            }
        }
        try js.evaluate(record.js)
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
        cacheLock.lock()
        defer { cacheLock.unlock() }
        if let cache = freshCache, now.timeIntervalSince(cache.date) < maxAge {
            return cache.payload
        }
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
        runtime.store.save(json)
        freshCache = (now, payload)
        return payload
    }

    private static let cacheLock = NSLock()
    // Guarded by cacheLock (a short-lived burst of timeline requests shares
    // one bundle eval); the lock is the synchronization, hence unsafe.
    nonisolated(unsafe) private static var freshCache: (date: Date, payload: PublishedWidgets)?

    /// Called when an intent handler publishes a newer payload.
    static func invalidateCache() {
        cacheLock.lock()
        freshCache = nil
        cacheLock.unlock()
    }
}
#endif
