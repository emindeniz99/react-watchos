import Foundation
import CQuickJS
import ReactWatchCore
import WidgetKit

/// Short-lived QuickJS instance for the widget extension. Evaluates the
/// same bundle as the watch app with `__entrypoint = "intent"`, so JS
/// registers its widgets/intents but does not mount UI. Used for:
///   - control AppIntents: `IntentRuntime.handle(intent:)` dispatches to
///     the React-registered handler, which mutates shared Storage and
///     republishes timelines;
///   - on-demand refresh: `renderFreshTimelines()` recomputes timelines
///     while the app stays closed.
///
/// Budget: widget extension processes get ~30MB; the measured footprint
/// of engine + bundle is ~6MB peak (tools/embed-smoke), and the memory
/// limit below makes QuickJS fail loudly long before the OS jetsams us.
/// NOTE: untested until built with Xcode on macOS.
final class IntentRuntime {
    private let runtime: OpaquePointer
    private let context: OpaquePointer
    private var armedTimers: [Int32] = []

    init?() {
        guard let rt = JS_NewRuntime(), let ctx = JS_NewContext(rt) else {
            return nil
        }
        runtime = rt
        context = ctx
        JS_SetMemoryLimit(rt, 16 * 1024 * 1024)
        JS_SetContextOpaque(ctx, Unmanaged.passUnretained(self).toOpaque())
        installGlobals()
        guard evaluateBundle() else { return nil }
    }

    deinit {
        JS_FreeContext(context)
        JS_FreeRuntime(runtime)
    }

    // MARK: - Public API

    /// Runs a React-registered intent handler. Handlers republish
    /// timelines themselves via __host.publishWidgets.
    @discardableResult
    static func handle(intent name: String) -> Bool {
        guard let runtime = IntentRuntime() else { return false }
        return runtime.callBool("globalThis.__handleIntent(\(Self.literal(name)))")
    }

    /// Recomputes all timelines without going through publish. Persists
    /// the result so other widget kinds see it too. WidgetKit asks every
    /// kind/family in a burst, so a short-lived cache keeps one reload
    /// cycle to a single bundle evaluation.
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
        guard let json = runtime.callString("globalThis.__renderWidgets(\(ms))"),
              let payload = try? JSONDecoder().decode(
                  PublishedWidgets.self, from: Data(json.utf8)) else {
            return nil
        }
        UserDefaults(suiteName: WidgetStore.appGroupId)?
            .set(json, forKey: WidgetStore.payloadKey)
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

    // MARK: - Evaluation

    private func evaluateBundle() -> Bool {
        // Prefer precompiled bytecode (faster cold start in the short-lived
        // extension), fall back to parsing bundle.js.
        if let qbc = Bundle.main.url(forResource: "bundle", withExtension: "qbc"),
           let data = try? Data(contentsOf: qbc) {
            let fn = data.withUnsafeBytes { raw -> JSValue in
                JS_ReadObject(context, raw.bindMemory(to: UInt8.self).baseAddress,
                              data.count, qjs_read_obj_bytecode())
            }
            if !JS_IsException(fn) {
                let result = JS_EvalFunction(context, fn)
                defer { JS_FreeValue(context, result) }
                if !JS_IsException(result) {
                    drain()
                    return true
                }
            }
            logException()  // fall through to source
        }
        guard let url = Bundle.main.url(forResource: "bundle", withExtension: "js"),
              let code = try? String(contentsOf: url, encoding: .utf8) else {
            return false
        }
        let result = code.withCString { ptr in
            JS_Eval(context, ptr, strlen(ptr), "bundle.js", qjs_eval_type_global())
        }
        defer { JS_FreeValue(context, result) }
        if JS_IsException(result) {
            logException()
            return false
        }
        drain()
        return true
    }

    private func callBool(_ code: String) -> Bool {
        let result = eval(code)
        defer { JS_FreeValue(context, result) }
        drain()
        return JS_ToBool(context, result) == 1
    }

    private func callString(_ code: String) -> String? {
        let result = eval(code)
        defer { JS_FreeValue(context, result) }
        drain()
        guard !JS_IsException(result),
              let cString = JS_ToCString(context, result) else {
            logException()
            return nil
        }
        defer { JS_FreeCString(context, cString) }
        return String(cString: cString)
    }

    private func eval(_ code: String) -> JSValue {
        code.withCString { ptr in
            JS_Eval(context, ptr, strlen(ptr), "intent.js", qjs_eval_type_global())
        }
    }

    /// Pending microtasks plus any timers JS armed (scheduler housekeeping)
    /// — the extension is short-lived, so timers fire eagerly, like the
    /// reference harness in tools/embed-smoke.
    private func drain() {
        var ctx: OpaquePointer?
        while JS_ExecutePendingJob(runtime, &ctx) > 0 {}
        var rounds = 0
        while !armedTimers.isEmpty, rounds < 100 {
            let id = armedTimers.removeFirst()
            let result = eval("globalThis.__fireTimer(\(id))")
            JS_FreeValue(context, result)
            while JS_ExecutePendingJob(runtime, &ctx) > 0 {}
            rounds += 1
        }
        if !armedTimers.isEmpty {
            print("[widget-js] timer drain cap hit; dropped",
                  armedTimers.count, "timers")
        }
    }

    private func logException() {
        let exception = JS_GetException(context)
        defer { JS_FreeValue(context, exception) }
        if let cString = JS_ToCString(context, exception) {
            print("[widget-js]", String(cString: cString))
            JS_FreeCString(context, cString)
        }
    }

    private static func literal(_ value: String) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: [value]))
            ?? Data("[\"\"]".utf8)
        let array = String(data: data, encoding: .utf8) ?? "[\"\"]"
        return String(array.dropFirst().dropLast())
    }

    // MARK: - Host globals

    private func installGlobals() {
        let global = JS_GetGlobalObject(context)
        defer { JS_FreeValue(context, global) }
        JS_SetPropertyStr(context, global, "__entrypoint",
                          JS_NewString(context, "intent"))

        let host = JS_NewObject(context)
        JS_SetPropertyStr(context, host, "commit",
                          JS_NewCFunction(context, widgetNoop, "commit", 1))
        JS_SetPropertyStr(context, host, "log",
                          JS_NewCFunction(context, widgetLog, "log", 1))
        JS_SetPropertyStr(context, host, "setTimer",
                          JS_NewCFunction(context, widgetSetTimer, "setTimer", 2))
        JS_SetPropertyStr(context, host, "clearTimer",
                          JS_NewCFunction(context, widgetClearTimer, "clearTimer", 1))
        JS_SetPropertyStr(context, host, "publishWidgets",
                          JS_NewCFunction(context, widgetPublish, "publishWidgets", 1))
        JS_SetPropertyStr(context, host, "getItem",
                          JS_NewCFunction(context, widgetGetItem, "getItem", 1))
        JS_SetPropertyStr(context, host, "setItem",
                          JS_NewCFunction(context, widgetSetItem, "setItem", 2))
        JS_SetPropertyStr(context, global, "__host", host)
    }

    fileprivate static func from(context: OpaquePointer?) -> IntentRuntime? {
        guard let context, let opaque = JS_GetContextOpaque(context) else {
            return nil
        }
        return Unmanaged<IntentRuntime>.fromOpaque(opaque).takeUnretainedValue()
    }

    fileprivate func armTimer(id: Int32) { armedTimers.append(id) }
    fileprivate func disarmTimer(id: Int32) {
        armedTimers.removeAll { $0 == id }
    }
}

private func widgetNoop(
    ctx: OpaquePointer?, thisVal: JSValue, argc: Int32,
    argv: UnsafeMutablePointer<JSValue>?
) -> JSValue {
    qjs_undefined()
}

private func widgetLog(
    ctx: OpaquePointer?, thisVal: JSValue, argc: Int32,
    argv: UnsafeMutablePointer<JSValue>?
) -> JSValue {
    if let argv, argc >= 1, let cString = JS_ToCString(ctx, argv[0]) {
        print("[widget-js]", String(cString: cString))
        JS_FreeCString(ctx, cString)
    }
    return qjs_undefined()
}

private func widgetSetTimer(
    ctx: OpaquePointer?, thisVal: JSValue, argc: Int32,
    argv: UnsafeMutablePointer<JSValue>?
) -> JSValue {
    if let runtime = IntentRuntime.from(context: ctx), let argv, argc >= 1 {
        var id: Int32 = 0
        JS_ToInt32(ctx, &id, argv[0])
        runtime.armTimer(id: id)
    }
    return qjs_undefined()
}

private func widgetClearTimer(
    ctx: OpaquePointer?, thisVal: JSValue, argc: Int32,
    argv: UnsafeMutablePointer<JSValue>?
) -> JSValue {
    if let runtime = IntentRuntime.from(context: ctx), let argv, argc >= 1 {
        var id: Int32 = 0
        JS_ToInt32(ctx, &id, argv[0])
        runtime.disarmTimer(id: id)
    }
    return qjs_undefined()
}

private func widgetPublish(
    ctx: OpaquePointer?, thisVal: JSValue, argc: Int32,
    argv: UnsafeMutablePointer<JSValue>?
) -> JSValue {
    if let argv, argc >= 1, let cString = JS_ToCString(ctx, argv[0]) {
        UserDefaults(suiteName: WidgetStore.appGroupId)?
            .set(String(cString: cString), forKey: WidgetStore.payloadKey)
        JS_FreeCString(ctx, cString)
        IntentRuntime.invalidateCache()
        WidgetCenter.shared.reloadAllTimelines()
    }
    return qjs_undefined()
}

private func widgetGetItem(
    ctx: OpaquePointer?, thisVal: JSValue, argc: Int32,
    argv: UnsafeMutablePointer<JSValue>?
) -> JSValue {
    guard let argv, argc >= 1, let keyC = JS_ToCString(ctx, argv[0]) else {
        return qjs_null()
    }
    let key = String(cString: keyC)
    JS_FreeCString(ctx, keyC)
    guard let value = UserDefaults(suiteName: WidgetStore.appGroupId)?
        .string(forKey: WidgetStore.storagePrefix + key) else {
        return qjs_null()
    }
    return JS_NewString(ctx, value)
}

private func widgetSetItem(
    ctx: OpaquePointer?, thisVal: JSValue, argc: Int32,
    argv: UnsafeMutablePointer<JSValue>?
) -> JSValue {
    if let argv, argc >= 2, let keyC = JS_ToCString(ctx, argv[0]),
       let valueC = JS_ToCString(ctx, argv[1]) {
        UserDefaults(suiteName: WidgetStore.appGroupId)?.set(
            String(cString: valueC),
            forKey: WidgetStore.storagePrefix + String(cString: keyC))
        JS_FreeCString(ctx, keyC)
        JS_FreeCString(ctx, valueC)
    }
    return qjs_undefined()
}
