import Foundation
import ReactWatchCore
import ReactWatchRuntime
import WidgetKit

/// Short-lived QuickJS instance for the widget extension. Reuses the shared
/// `ReactWatchRuntime.JSRuntime` — the same engine embedding the watch app
/// uses, so there's one implementation, not two — evaluating the same bundle
/// with `__entrypoint = "intent"` so JS registers its widgets/intents but does
/// not mount UI. Used for:
///   - control AppIntents: `IntentRuntime.handle(intent:)` dispatches to the
///     React-registered handler, which mutates shared Storage and republishes
///     timelines;
///   - on-demand refresh: `renderFreshTimelines()` recomputes timelines while
///     the app stays closed.
///
/// Budget: widget extension processes get ~30MB; the engine + bundle measure
/// ~6MB peak (tools/embed-smoke), and the 16MB cap makes QuickJS fail loudly
/// long before the OS jetsams us.
/// NOTE: untested until built with Xcode on macOS (WidgetKit).
final class IntentRuntime {
    private let js: JSRuntime
    private let store: SharedWidgetStore

    init?() {
        store = SharedWidgetStore(appGroupId: WidgetStore.appGroupId)
        guard let js = try? JSRuntime(memoryLimitBytes: 16 * 1024 * 1024) else {
            return nil
        }
        self.js = js
        // The intent entrypoint must not mount UI; ignore any commit.
        js.onCommit = { _ in }
        js.onPublishWidgets = { [store] json in store.save(json) }
        js.onGetItem = { [store] key in store.getItem(key) }
        js.onSetItem = { [store] key, value in store.setItem(key, value) }
        do {
            try js.evaluate(
                "globalThis.__entrypoint = \"intent\"", filename: "entry.js")
            try loadBundle()
        } catch {
            return nil
        }
    }

    private func loadBundle() throws {
        // Prefer precompiled bytecode (faster cold start in the short-lived
        // extension), fall back to parsing bundle.js.
        if let qbc = Bundle.main.url(forResource: "bundle", withExtension: "qbc"),
           let data = try? Data(contentsOf: qbc) {
            do {
                try js.evaluateBytecode(data)
                return
            } catch {
                // fall through to source
            }
        }
        guard let url = Bundle.main.url(forResource: "bundle", withExtension: "js"),
              let code = try? String(contentsOf: url, encoding: .utf8) else {
            throw JSRuntime.JSError.exception("bundle missing — run `npm run build`")
        }
        try js.evaluate(code)
    }

    // MARK: - Public API

    /// Runs a React-registered intent handler. Handlers republish timelines
    /// themselves via __host.publishWidgets.
    @discardableResult
    static func handle(intent name: String) -> Bool {
        guard let runtime = IntentRuntime() else { return false }
        return runtime.js.evaluateBool(
            "globalThis.__handleIntent(\(literal(name)))")
    }

    /// Recomputes all timelines without going through publish. Persists the
    /// result so other widget kinds see it too. WidgetKit asks every
    /// kind/family in a burst, so a short-lived cache keeps one reload cycle to
    /// a single bundle evaluation.
    static func renderFreshTimelines(
        now: Date = .now, maxAge: TimeInterval = 5
    ) -> PublishedWidgets? {
        cacheLock.lock()
        defer { cacheLock.unlock() }
        if let cache = freshCache, now.timeIntervalSince(cache.date) < maxAge {
            return cache.payload
        }
        guard let runtime = IntentRuntime() else { return nil }
        let ms = now.timeIntervalSince1970 * 1000
        guard let json = runtime.js.evaluateString(
                  "globalThis.__renderWidgets(\(ms))"),
              let payload = try? JSONDecoder().decode(
                  PublishedWidgets.self, from: Data(json.utf8)) else {
            return nil
        }
        runtime.store.save(json)
        freshCache = (now, payload)
        return payload
    }

    private static let cacheLock = NSLock()
    private static var freshCache: (date: Date, payload: PublishedWidgets)?

    /// Called when an intent handler publishes a newer payload.
    static func invalidateCache() {
        cacheLock.lock()
        freshCache = nil
        cacheLock.unlock()
    }

    private static func literal(_ value: String) -> String {
        let data = (try? JSONSerialization.data(
            withJSONObject: [value])) ?? Data("[\"\"]".utf8)
        let array = String(data: data, encoding: .utf8) ?? "[\"\"]"
        return String(array.dropFirst().dropLast())
    }
}
