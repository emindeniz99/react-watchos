import CQuickJS
import Foundation

/// Embeds QuickJS and hosts the React bundle. Mirrors the verified
/// reference embedding in tools/embed-smoke/embed-host.c:
///   1. install __host.{commit,log,setTimer,clearTimer}
///   2. evaluate bundle.js (first tree is committed during eval)
///   3. drain pending jobs after every entry into JS
///   4. deliver interactions via __dispatchEvent and timers via __fireTimer
///
/// Foundation + the CQuickJS module only (no SwiftUI), so this — the actual
/// engine embedding — compiles and is smoke-tested on Linux. The SwiftUI
/// interpreter and native bridges live in ReactWatchHost.
public final class JSRuntime {
    public enum JSError: Error {
        case initialization
        case exception(String)
    }

    /// Called with the raw JSON tree string on every React commit.
    public var onCommit: ((String) -> Void)?

    /// Called with the rendered widget-timelines payload whenever JS calls
    /// __host.publishWidgets (persist + WidgetCenter reload).
    public var onPublishWidgets: ((String) -> Void)?

    /// Key/value storage bridge (App Group UserDefaults).
    public var onGetItem: ((String) -> String?)?
    public var onSetItem: ((String, String) -> Void)?

    /// Non-fatal JS exceptions (event handlers, timers). Without this,
    /// runtime errors after startup would be silently swallowed.
    public var onError: ((String) -> Void)?

    /// WKHapticType name from js/src/haptics.ts.
    public var onPlayHaptic: ((String) -> Void)?

    /// Local notifications (js/src/notifications.ts).
    public var onRequestNotificationPermission: (() -> Void)?
    public var onScheduleNotification: ((String) -> Void)?
    public var onCancelNotification: ((String) -> Void)?

    /// WatchConnectivity send (js/src/connectivity.ts).
    public var onSendToPhone: ((String) -> Void)?

    /// Async HTTP request (js/src/fetch.ts). Settle with
    /// resolveFetch/rejectFetch on the main thread.
    public var onFetch: ((Int, String) -> Void)?
    /// Cancel an in-flight fetch by id.
    public var onAbortFetch: ((Int) -> Void)?

    /// CoreBluetooth op channel (js/src/bluetooth.ts): { op, ... }.
    public var onBle: ((String) -> Void)?
    /// Sensor op channel (js/src/sensors.ts): { op, kind }.
    public var onSensor: ((String) -> Void)?
    /// Persist an OTA JS bundle (js/src/update.ts).
    public var onSaveUpdate: ((String) -> Void)?
    /// On-device LLM generate (js/src/ai.ts). Settle with
    /// resolveGenerate/rejectGenerate on the main thread.
    public var onGenerate: ((Int, String) -> Void)?

    private let runtime: OpaquePointer
    private let context: OpaquePointer
    private var pendingTimers: [Int32: DispatchWorkItem] = [:]

    /// Selects the Swift→JS call mechanism (CR-5). true: direct `JS_Call` on
    /// cached global functions — no per-call parse/compile, and not the
    /// "code assembled from runtime data" shape the eval path had. false: the
    /// legacy eval-string path. Kept switchable so the two can be A/B-compared
    /// on a real watch before the eval path is retired (the args are identical
    /// — numbers and a JSON string the JS parses — so the paths are equivalent).
    public var useJSCallBridge = true
    /// Global JS functions (`__dispatchEvent`, …) retained for `JS_Call`,
    /// looked up lazily once the bundle defines them. Freed in deinit.
    private var globalFnCache: [String: JSValue] = [:]

    /// - Parameter memoryLimitBytes: caps the QuickJS heap (the widget
    ///   extension runs in a tight ~30MB budget; nil = unlimited).
    public init(memoryLimitBytes: Int? = nil) throws {
        guard let rt = JS_NewRuntime(), let ctx = JS_NewContext(rt) else {
            throw JSError.initialization
        }
        runtime = rt
        context = ctx
        if let memoryLimitBytes {
            JS_SetMemoryLimit(rt, size_t(memoryLimitBytes))
        }
        JS_SetContextOpaque(ctx, Unmanaged.passUnretained(self).toOpaque())
        installHostObject()
        // Surface unhandled promise rejections. drainJobs only sees a thrown
        // *job* (status < 0); a bare rejection — a rejected fetch/generateText
        // or an async handler with no .catch — never throws at the job level,
        // it only notifies this tracker. Without it those async failures
        // vanish, the same fail-loud gap drainJobs had.
        JS_SetHostPromiseRejectionTracker(rt, promiseRejectionTracker, nil)
    }

    deinit {
        pendingTimers.values.forEach { $0.cancel() }
        globalFnCache.values.forEach { JS_FreeValue(context, $0) }
        JS_FreeContext(context)
        JS_FreeRuntime(runtime)
    }

    // MARK: - Public API

    public func evaluate(_ code: String, filename: String = "bundle.js") throws {
        let result = code.withCString { codePtr in
            JS_Eval(context, codePtr, strlen(codePtr), filename,
                    qjs_eval_type_global())
        }
        defer { JS_FreeValue(context, result) }
        if JS_IsException(result) {
            throw JSError.exception(takeExceptionMessage())
        }
        drainJobs()
    }

    /// Loads a precompiled QuickJS bytecode bundle (no parser, faster cold
    /// start). The bytecode must come from the same quickjs-ng version the
    /// app embeds (tools/qjs-compile); callers should fall back to the JS
    /// source if this throws.
    public func evaluateBytecode(_ data: Data) throws {
        let fn = data.withUnsafeBytes { raw -> JSValue in
            JS_ReadObject(context, raw.bindMemory(to: UInt8.self).baseAddress,
                          data.count, qjs_read_obj_bytecode())
        }
        if JS_IsException(fn) {
            throw JSError.exception(takeExceptionMessage())
        }
        let result = JS_EvalFunction(context, fn)
        defer { JS_FreeValue(context, result) }
        if JS_IsException(result) {
            throw JSError.exception(takeExceptionMessage())
        }
        drainJobs()
    }

    /// Compiles `source` to QuickJS bytecode without running it (CR-17), for
    /// caching an OTA bundle so cold start skips the parser. The bytecode is
    /// only valid for this exact quickjs-ng version — load it with
    /// `evaluateBytecode`, which throws on a version mismatch so the caller can
    /// fall back to parsing the source. nil if `source` doesn't compile.
    public func compileToBytecode(_ source: String) -> Data? {
        let compiled = source.withCString { ptr in
            JS_Eval(context, ptr, strlen(ptr), "bundle.js",
                    qjs_eval_flag_compile_only())
        }
        defer { JS_FreeValue(context, compiled) }
        if JS_IsException(compiled) { return nil }
        var size = 0
        guard let buf = JS_WriteObject(
            context, &size, compiled, qjs_write_obj_bytecode()) else { return nil }
        defer { js_free(context, buf) }
        return Data(bytes: buf, count: size)
    }

    public func dispatchEvent(
        nodeId: Int, event: String, payload: [String: Any]? = nil,
        seq: Int? = nil
    ) {
        var args: [JSArg] = [
            .int(nodeId), .string(event), .jsonOrUndefined(jsonString(payload)),
        ]
        if let seq { args.append(.int(seq)) }
        bridgeCall("__dispatchEvent", args, filename: "dispatch.js")
    }

    /// Settles a JS fetch Promise. MUST be called on the main thread (the
    /// QuickJS context lives there); URLSession completions hop here.
    public func resolveFetch(id: Int, responseJson: String) {
        bridgeCall("__resolveFetch", [.int(id), .string(responseJson)],
                   filename: "fetch.js")
    }

    public func rejectFetch(id: Int, message: String) {
        bridgeCall("__rejectFetch", [.int(id), .string(message)],
                   filename: "fetch.js")
    }

    /// Pushes a named native event into JS at urgent priority (runSync), so
    /// the resulting UI update commits immediately. Use for non-interaction
    /// state: connectivity, sensors, app lifecycle.
    public func pushNativeEvent(_ name: String, payload: [String: Any]? = nil) {
        bridgeCall("__pushNativeEvent",
                   [.string(name), .jsonOrUndefined(jsonString(payload))],
                   filename: "push.js")
    }

    /// Evaluates `code` and returns its result as a Bool (false on exception).
    /// Used by the widget extension's intent path (__handleIntent).
    public func evaluateBool(_ code: String) -> Bool {
        let result = code.withCString {
            JS_Eval(context, $0, strlen($0), "eval.js", qjs_eval_type_global())
        }
        defer { JS_FreeValue(context, result) }
        drainJobs()
        if JS_IsException(result) {
            onError?(takeExceptionMessage())
            return false
        }
        return JS_ToBool(context, result) == 1
    }

    /// Evaluates `code` and returns its result as a String (nil on exception).
    /// Used by the widget extension's intent path (__renderWidgets).
    public func evaluateString(_ code: String) -> String? {
        let result = code.withCString {
            JS_Eval(context, $0, strlen($0), "eval.js", qjs_eval_type_global())
        }
        defer { JS_FreeValue(context, result) }
        drainJobs()
        guard !JS_IsException(result),
              let cString = JS_ToCString(context, result) else {
            onError?(takeExceptionMessage())
            return nil
        }
        defer { JS_FreeCString(context, cString) }
        return String(cString: cString)
    }

    private func evaluateReportingErrors(_ code: String, filename: String) {
        do {
            try evaluate(code, filename: filename)
        } catch JSError.exception(let message) {
            onError?(message)
        } catch {
            onError?(String(describing: error))
        }
    }

    // MARK: - Swift -> JS bridge (CR-5)

    /// An argument to a global JS function. Both bridge paths render it: as a
    /// JSValue (JS_Call) or as JS source text (eval). The JSON payload crosses
    /// as a *string* the JS parses (matching the existing `index.ts` contract).
    private enum JSArg {
        case int(Int)
        case double(Double)
        case string(String)
        /// JSON payload as a JS string, or JS `undefined` when nil.
        case jsonOrUndefined(String?)
    }

    private func jsonString(_ payload: [String: Any]?) -> String? {
        payload.flatMap { try? JSONSerialization.data(withJSONObject: $0) }
            .flatMap { String(data: $0, encoding: .utf8) }
    }

    /// Calls `globalThis.<name>(args…)`. With `useJSCallBridge`, via JS_Call on
    /// the cached function (no parse, not injection-shaped); otherwise via the
    /// legacy eval-string path. The two are behaviorally identical — same args.
    private func bridgeCall(_ name: String, _ args: [JSArg], filename: String) {
        if useJSCallBridge {
            callGlobalFunction(name, args.map(makeValue))
        } else {
            let rendered = args.map(renderArg).joined(separator: ", ")
            evaluateReportingErrors("globalThis.\(name)(\(rendered))", filename: filename)
        }
    }

    private func makeValue(_ arg: JSArg) -> JSValue {
        switch arg {
        case .int(let n): return JS_NewInt32(context, Int32(truncatingIfNeeded: n))
        case .double(let d): return JS_NewFloat64(context, d)
        case .string(let s): return JS_NewString(context, s)
        case .jsonOrUndefined(let s):
            return s.map { JS_NewString(context, $0) } ?? qjs_undefined()
        }
    }

    private func renderArg(_ arg: JSArg) -> String {
        switch arg {
        case .int(let n): return "\(n)"
        case .double(let d): return "\(d)"
        case .string(let s): return jsStringLiteral(s)
        case .jsonOrUndefined(let s): return s.map(jsStringLiteral) ?? "undefined"
        }
    }

    /// JS_Call a cached global function, discarding the result (routes a thrown
    /// exception to onError).
    private func callGlobalFunction(_ name: String, _ args: [JSValue]) {
        if let result = callGlobalReturning(name, args) {
            JS_FreeValue(context, result)
        }
    }

    /// JS_Call a cached global function and return the (owned) result for the
    /// caller to convert + free; nil on a missing function or thrown exception
    /// (reported to onError). `args` are owned here and freed after the call.
    private func callGlobalReturning(_ name: String, _ args: [JSValue]) -> JSValue? {
        let fn = cachedGlobalFunction(name)
        guard JS_IsFunction(context, fn) else {
            args.forEach { JS_FreeValue(context, $0) }
            onError?("global \(name) is not a function")
            return nil
        }
        let global = JS_GetGlobalObject(context)
        defer { JS_FreeValue(context, global) }
        var argv = args
        let result = argv.withUnsafeMutableBufferPointer {
            JS_Call(context, fn, global, Int32($0.count), $0.baseAddress)
        }
        args.forEach { JS_FreeValue(context, $0) }
        drainJobs()
        if JS_IsException(result) {
            onError?(takeExceptionMessage())
            JS_FreeValue(context, result)
            return nil
        }
        return result
    }

    /// Calls `globalThis.<name>(stringArg)` and returns its Bool result (false
    /// on a missing function / exception). The widget intent-dispatch path
    /// (CR-5), gated by `useJSCallBridge` like the rest of the bridge.
    public func callReturningBool(_ name: String, _ stringArg: String) -> Bool {
        guard useJSCallBridge else {
            return evaluateBool("globalThis.\(name)(\(jsStringLiteral(stringArg)))")
        }
        guard let result = callGlobalReturning(name, [makeValue(.string(stringArg))])
        else { return false }
        defer { JS_FreeValue(context, result) }
        return JS_ToBool(context, result) == 1
    }

    /// Calls `globalThis.<name>(numberArg)` and returns its String result (nil
    /// on a missing function / exception). Used to render widget timelines.
    public func callReturningString(_ name: String, _ numberArg: Double) -> String? {
        guard useJSCallBridge else {
            return evaluateString("globalThis.\(name)(\(numberArg))")
        }
        guard let result = callGlobalReturning(name, [makeValue(.double(numberArg))])
        else { return nil }
        defer { JS_FreeValue(context, result) }
        guard let cString = JS_ToCString(context, result) else { return nil }
        defer { JS_FreeCString(context, cString) }
        return String(cString: cString)
    }

    /// Looks up and retains a global function for reuse. Not cached until the
    /// bundle has actually defined it, so an early call can't pin `undefined`.
    private func cachedGlobalFunction(_ name: String) -> JSValue {
        if let fn = globalFnCache[name] { return fn }
        let global = JS_GetGlobalObject(context)
        defer { JS_FreeValue(context, global) }
        let fn = JS_GetPropertyStr(context, global, name)
        if JS_IsFunction(context, fn) {
            globalFnCache[name] = fn
            return fn
        }
        JS_FreeValue(context, fn)
        return qjs_undefined()
    }

    // MARK: - Host bridge (JS -> Swift)

    private func installHostObject() {
        let global = JS_GetGlobalObject(context)
        defer { JS_FreeValue(context, global) }

        let host = JS_NewObject(context)
        JS_SetPropertyStr(context, host, "commit",
                          JS_NewCFunction(context, hostCommit, "commit", 1))
        JS_SetPropertyStr(context, host, "log",
                          JS_NewCFunction(context, hostLog, "log", 1))
        JS_SetPropertyStr(context, host, "setTimer",
                          JS_NewCFunction(context, hostSetTimer, "setTimer", 2))
        JS_SetPropertyStr(context, host, "clearTimer",
                          JS_NewCFunction(context, hostClearTimer, "clearTimer", 1))
        JS_SetPropertyStr(context, host, "publishWidgets",
                          JS_NewCFunction(context, hostPublishWidgets, "publishWidgets", 1))
        JS_SetPropertyStr(context, host, "getItem",
                          JS_NewCFunction(context, hostGetItem, "getItem", 1))
        JS_SetPropertyStr(context, host, "setItem",
                          JS_NewCFunction(context, hostSetItem, "setItem", 2))
        JS_SetPropertyStr(context, host, "playHaptic",
                          JS_NewCFunction(context, hostPlayHaptic, "playHaptic", 1))
        JS_SetPropertyStr(
            context, host, "requestNotificationPermission",
            JS_NewCFunction(context, hostRequestNotificationPermission,
                            "requestNotificationPermission", 0))
        JS_SetPropertyStr(
            context, host, "scheduleNotification",
            JS_NewCFunction(context, hostScheduleNotification,
                            "scheduleNotification", 1))
        JS_SetPropertyStr(
            context, host, "cancelNotification",
            JS_NewCFunction(context, hostCancelNotification,
                            "cancelNotification", 1))
        JS_SetPropertyStr(context, host, "sendToPhone",
                          JS_NewCFunction(context, hostSendToPhone, "sendToPhone", 1))
        JS_SetPropertyStr(context, host, "fetch",
                          JS_NewCFunction(context, hostFetch, "fetch", 2))
        JS_SetPropertyStr(context, host, "abortFetch",
                          JS_NewCFunction(context, hostAbortFetch, "abortFetch", 1))
        JS_SetPropertyStr(context, host, "ble",
                          JS_NewCFunction(context, hostBle, "ble", 1))
        JS_SetPropertyStr(context, host, "sensor",
                          JS_NewCFunction(context, hostSensor, "sensor", 1))
        JS_SetPropertyStr(context, host, "saveUpdate",
                          JS_NewCFunction(context, hostSaveUpdate, "saveUpdate", 1))
        JS_SetPropertyStr(context, host, "generate",
                          JS_NewCFunction(context, hostGenerate, "generate", 2))
        // JS_SetPropertyStr takes ownership of `host`.
        JS_SetPropertyStr(context, global, "__host", host)
    }

    private func handleCommit(_ json: String) {
        onCommit?(json)
    }

    private func scheduleTimer(id: Int32, milliseconds: Double) {
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.pendingTimers[id] = nil
            self.bridgeCall("__fireTimer", [.int(Int(id))], filename: "timer.js")
        }
        pendingTimers[id] = work
        DispatchQueue.main.asyncAfter(
            deadline: .now() + milliseconds / 1000.0, execute: work)
    }

    private func cancelTimer(id: Int32) {
        pendingTimers.removeValue(forKey: id)?.cancel()
    }

    // MARK: - Internals

    private func drainJobs() {
        var ctx: OpaquePointer?
        // JS_ExecutePendingJob returns >0 when a job ran, 0 when the queue is
        // empty, and <0 when a job threw (an unhandled promise rejection, an
        // async handler that throws, a rejected fetch/generateText). On <0 the
        // exception is left pending on the context: read and surface it via
        // onError instead of silently dropping it — otherwise async failures
        // vanish, contradicting the runtime's fail-loud contract. Keep
        // draining afterwards so one bad job doesn't stall the rest of the
        // microtask queue (takeExceptionMessage clears the pending exception).
        while true {
            let status = JS_ExecutePendingJob(runtime, &ctx)
            if status == 0 { break }
            if status < 0 { onError?(takeExceptionMessage()) }
        }
    }

    private func takeExceptionMessage() -> String {
        let exception = JS_GetException(context)
        defer { JS_FreeValue(context, exception) }
        return describe(exception)
    }

    /// Formats a JS value — a thrown exception or a rejection reason — as
    /// "message\nstack" the dev overlay expects.
    private func describe(_ value: JSValue) -> String {
        var message = "unknown JS exception"
        if let cString = JS_ToCString(context, value) {
            message = String(cString: cString)
            JS_FreeCString(context, cString)
        }
        // Append the JS stack only for real Error objects (QuickJS exposes it
        // on the error object). A thrown/rejected primitive — e.g.
        // `Promise.reject("oops")` — has no `.stack`; reading the missing
        // property would otherwise append a literal "undefined" line (OP-5).
        if JS_IsError(value) {
            let stackVal = JS_GetPropertyStr(context, value, "stack")
            if let stackC = JS_ToCString(context, stackVal) {
                let stack = String(cString: stackC)
                if !stack.isEmpty { message += "\n" + stack }
                JS_FreeCString(context, stackC)
            }
            JS_FreeValue(context, stackVal)
        }
        return message
    }

    /// Routes an unhandled promise rejection to onError. "Possibly" because
    /// quickjs-ng fires the tracker eagerly; a late .catch sends the matching
    /// is_handled callback we ignore in promiseRejectionTracker.
    fileprivate func reportUnhandledRejection(_ reason: JSValue) {
        onError?("Possibly unhandled promise rejection: " + describe(reason))
    }

    private func jsStringLiteral(_ value: String) -> String {
        let data = (try? JSONSerialization.data(
            withJSONObject: [value])) ?? Data("[\"\"]".utf8)
        let array = String(data: data, encoding: .utf8) ?? "[\"\"]"
        return String(array.dropFirst().dropLast())
    }

    fileprivate static func from(context: OpaquePointer?) -> JSRuntime? {
        guard let context, let opaque = JS_GetContextOpaque(context) else {
            return nil
        }
        return Unmanaged<JSRuntime>.fromOpaque(opaque).takeUnretainedValue()
    }
}

// @convention(c) callbacks cannot capture state; the owning JSRuntime is
// recovered through the context opaque pointer.

// quickjs-ng calls this whenever a promise's rejection-handled state changes.
// We act only on the "no handler" edge (isHandled == false); the matching
// isHandled == true callback (a late .catch) is ignored. Report-only, like
// quickjs-ng's own CLI tracker.
private func promiseRejectionTracker(
    ctx: OpaquePointer?, promise: JSValue, reason: JSValue,
    isHandled: Bool, opaque: UnsafeMutableRawPointer?
) {
    guard !isHandled, let runtime = JSRuntime.from(context: ctx) else { return }
    runtime.reportUnhandledRejection(reason)
}

private func hostCommit(
    ctx: OpaquePointer?, thisVal: JSValue, argc: Int32,
    argv: UnsafeMutablePointer<JSValue>?
) -> JSValue {
    if let runtime = JSRuntime.from(context: ctx), let argv, argc >= 1,
       let cString = JS_ToCString(ctx, argv[0]) {
        runtime.handleCommitFromC(String(cString: cString))
        JS_FreeCString(ctx, cString)
    }
    return qjs_undefined()
}

private func hostLog(
    ctx: OpaquePointer?, thisVal: JSValue, argc: Int32,
    argv: UnsafeMutablePointer<JSValue>?
) -> JSValue {
    if let argv, argc >= 1, let cString = JS_ToCString(ctx, argv[0]) {
        print("[js]", String(cString: cString))
        JS_FreeCString(ctx, cString)
    }
    return qjs_undefined()
}

private func hostPublishWidgets(
    ctx: OpaquePointer?, thisVal: JSValue, argc: Int32,
    argv: UnsafeMutablePointer<JSValue>?
) -> JSValue {
    if let runtime = JSRuntime.from(context: ctx), let argv, argc >= 1,
       let cString = JS_ToCString(ctx, argv[0]) {
        runtime.handlePublishWidgetsFromC(String(cString: cString))
        JS_FreeCString(ctx, cString)
    }
    return qjs_undefined()
}

private func hostPlayHaptic(
    ctx: OpaquePointer?, thisVal: JSValue, argc: Int32,
    argv: UnsafeMutablePointer<JSValue>?
) -> JSValue {
    if let runtime = JSRuntime.from(context: ctx), let argv, argc >= 1,
       let cString = JS_ToCString(ctx, argv[0]) {
        runtime.playHapticFromC(String(cString: cString))
        JS_FreeCString(ctx, cString)
    }
    return qjs_undefined()
}

private func hostRequestNotificationPermission(
    ctx: OpaquePointer?, thisVal: JSValue, argc: Int32,
    argv: UnsafeMutablePointer<JSValue>?
) -> JSValue {
    JSRuntime.from(context: ctx)?.requestNotificationPermissionFromC()
    return qjs_undefined()
}

private func hostScheduleNotification(
    ctx: OpaquePointer?, thisVal: JSValue, argc: Int32,
    argv: UnsafeMutablePointer<JSValue>?
) -> JSValue {
    if let runtime = JSRuntime.from(context: ctx), let argv, argc >= 1,
       let cString = JS_ToCString(ctx, argv[0]) {
        runtime.scheduleNotificationFromC(String(cString: cString))
        JS_FreeCString(ctx, cString)
    }
    return qjs_undefined()
}

private func hostCancelNotification(
    ctx: OpaquePointer?, thisVal: JSValue, argc: Int32,
    argv: UnsafeMutablePointer<JSValue>?
) -> JSValue {
    if let runtime = JSRuntime.from(context: ctx), let argv, argc >= 1,
       let cString = JS_ToCString(ctx, argv[0]) {
        runtime.cancelNotificationFromC(String(cString: cString))
        JS_FreeCString(ctx, cString)
    }
    return qjs_undefined()
}

private func hostSendToPhone(
    ctx: OpaquePointer?, thisVal: JSValue, argc: Int32,
    argv: UnsafeMutablePointer<JSValue>?
) -> JSValue {
    if let runtime = JSRuntime.from(context: ctx), let argv, argc >= 1,
       let cString = JS_ToCString(ctx, argv[0]) {
        runtime.sendToPhoneFromC(String(cString: cString))
        JS_FreeCString(ctx, cString)
    }
    return qjs_undefined()
}

private func hostFetch(
    ctx: OpaquePointer?, thisVal: JSValue, argc: Int32,
    argv: UnsafeMutablePointer<JSValue>?
) -> JSValue {
    if let runtime = JSRuntime.from(context: ctx), let argv, argc >= 2,
       let cString = JS_ToCString(ctx, argv[1]) {
        var id: Int32 = 0
        JS_ToInt32(ctx, &id, argv[0])
        runtime.fetchFromC(Int(id), String(cString: cString))
        JS_FreeCString(ctx, cString)
    }
    return qjs_undefined()
}

private func hostBle(
    ctx: OpaquePointer?, thisVal: JSValue, argc: Int32,
    argv: UnsafeMutablePointer<JSValue>?
) -> JSValue {
    if let runtime = JSRuntime.from(context: ctx), let argv, argc >= 1,
       let cString = JS_ToCString(ctx, argv[0]) {
        runtime.bleFromC(String(cString: cString))
        JS_FreeCString(ctx, cString)
    }
    return qjs_undefined()
}

private func hostSensor(
    ctx: OpaquePointer?, thisVal: JSValue, argc: Int32,
    argv: UnsafeMutablePointer<JSValue>?
) -> JSValue {
    if let runtime = JSRuntime.from(context: ctx), let argv, argc >= 1,
       let cString = JS_ToCString(ctx, argv[0]) {
        runtime.sensorFromC(String(cString: cString))
        JS_FreeCString(ctx, cString)
    }
    return qjs_undefined()
}

private func hostSaveUpdate(
    ctx: OpaquePointer?, thisVal: JSValue, argc: Int32,
    argv: UnsafeMutablePointer<JSValue>?
) -> JSValue {
    if let runtime = JSRuntime.from(context: ctx), let argv, argc >= 1,
       let cString = JS_ToCString(ctx, argv[0]) {
        runtime.saveUpdateFromC(String(cString: cString))
        JS_FreeCString(ctx, cString)
    }
    return qjs_undefined()
}

private func hostGenerate(
    ctx: OpaquePointer?, thisVal: JSValue, argc: Int32,
    argv: UnsafeMutablePointer<JSValue>?
) -> JSValue {
    if let runtime = JSRuntime.from(context: ctx), let argv, argc >= 2,
       let cString = JS_ToCString(ctx, argv[1]) {
        var id: Int32 = 0
        JS_ToInt32(ctx, &id, argv[0])
        runtime.generateFromC(Int(id), String(cString: cString))
        JS_FreeCString(ctx, cString)
    }
    return qjs_undefined()
}

private func hostAbortFetch(
    ctx: OpaquePointer?, thisVal: JSValue, argc: Int32,
    argv: UnsafeMutablePointer<JSValue>?
) -> JSValue {
    if let runtime = JSRuntime.from(context: ctx), let argv, argc >= 1 {
        var id: Int32 = 0
        JS_ToInt32(ctx, &id, argv[0])
        runtime.abortFetchFromC(Int(id))
    }
    return qjs_undefined()
}

private func hostGetItem(
    ctx: OpaquePointer?, thisVal: JSValue, argc: Int32,
    argv: UnsafeMutablePointer<JSValue>?
) -> JSValue {
    guard let runtime = JSRuntime.from(context: ctx), let argv, argc >= 1,
          let keyC = JS_ToCString(ctx, argv[0]) else { return qjs_null() }
    let key = String(cString: keyC)
    JS_FreeCString(ctx, keyC)
    guard let value = runtime.getItemFromC(key) else { return qjs_null() }
    return JS_NewString(ctx, value)
}

private func hostSetItem(
    ctx: OpaquePointer?, thisVal: JSValue, argc: Int32,
    argv: UnsafeMutablePointer<JSValue>?
) -> JSValue {
    if let runtime = JSRuntime.from(context: ctx), let argv, argc >= 2,
       let keyC = JS_ToCString(ctx, argv[0]),
       let valueC = JS_ToCString(ctx, argv[1]) {
        runtime.setItemFromC(String(cString: keyC), String(cString: valueC))
        JS_FreeCString(ctx, keyC)
        JS_FreeCString(ctx, valueC)
    }
    return qjs_undefined()
}

private func hostSetTimer(
    ctx: OpaquePointer?, thisVal: JSValue, argc: Int32,
    argv: UnsafeMutablePointer<JSValue>?
) -> JSValue {
    if let runtime = JSRuntime.from(context: ctx), let argv, argc >= 2 {
        var id: Int32 = 0
        var ms: Double = 0
        JS_ToInt32(ctx, &id, argv[0])
        JS_ToFloat64(ctx, &ms, argv[1])
        runtime.scheduleTimerFromC(id: id, milliseconds: ms)
    }
    return qjs_undefined()
}

private func hostClearTimer(
    ctx: OpaquePointer?, thisVal: JSValue, argc: Int32,
    argv: UnsafeMutablePointer<JSValue>?
) -> JSValue {
    if let runtime = JSRuntime.from(context: ctx), let argv, argc >= 1 {
        var id: Int32 = 0
        JS_ToInt32(ctx, &id, argv[0])
        runtime.cancelTimerFromC(id: id)
    }
    return qjs_undefined()
}

extension JSRuntime {
    fileprivate func handleCommitFromC(_ json: String) { handleCommit(json) }
    fileprivate func handlePublishWidgetsFromC(_ json: String) {
        onPublishWidgets?(json)
    }
    fileprivate func getItemFromC(_ key: String) -> String? { onGetItem?(key) }
    fileprivate func playHapticFromC(_ type: String) { onPlayHaptic?(type) }
    fileprivate func requestNotificationPermissionFromC() {
        onRequestNotificationPermission?()
    }
    fileprivate func scheduleNotificationFromC(_ json: String) {
        onScheduleNotification?(json)
    }
    fileprivate func cancelNotificationFromC(_ id: String) {
        onCancelNotification?(id)
    }
    fileprivate func sendToPhoneFromC(_ json: String) {
        onSendToPhone?(json)
    }
    fileprivate func fetchFromC(_ id: Int, _ json: String) {
        onFetch?(id, json)
    }
    fileprivate func abortFetchFromC(_ id: Int) {
        onAbortFetch?(id)
    }
    fileprivate func bleFromC(_ json: String) {
        onBle?(json)
    }
    fileprivate func sensorFromC(_ json: String) {
        onSensor?(json)
    }
    fileprivate func saveUpdateFromC(_ js: String) {
        onSaveUpdate?(js)
    }
    fileprivate func generateFromC(_ id: Int, _ json: String) {
        onGenerate?(id, json)
    }

    /// Settles a generateText Promise on the main thread (where the context
    /// lives).
    public func resolveGenerate(id: Int, text: String) {
        bridgeCall("__resolveGenerate", [.int(id), .string(text)], filename: "ai.js")
    }
    public func rejectGenerate(id: Int, message: String) {
        bridgeCall("__rejectGenerate", [.int(id), .string(message)], filename: "ai.js")
    }
    fileprivate func setItemFromC(_ key: String, _ value: String) {
        onSetItem?(key, value)
    }
    fileprivate func scheduleTimerFromC(id: Int32, milliseconds: Double) {
        scheduleTimer(id: id, milliseconds: milliseconds)
    }
    fileprivate func cancelTimerFromC(id: Int32) { cancelTimer(id: id) }
}
