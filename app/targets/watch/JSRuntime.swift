import Foundation

/// Embeds QuickJS and hosts the React bundle. Mirrors the verified
/// reference embedding in tools/embed-smoke/embed-host.c:
///   1. install __host.{commit,log,setTimer,clearTimer}
///   2. evaluate bundle.js (first tree is committed during eval)
///   3. drain pending jobs after every entry into JS
///   4. deliver interactions via __dispatchEvent and timers via __fireTimer
///
/// NOTE: untested until built with Xcode on macOS — see project README.
final class JSRuntime {
    enum JSError: Error {
        case initialization
        case exception(String)
    }

    /// Called with the raw JSON tree string on every React commit.
    var onCommit: ((String) -> Void)?

    /// Called with the rendered widget-timelines payload whenever JS calls
    /// __host.publishWidgets (persist + WidgetCenter reload).
    var onPublishWidgets: ((String) -> Void)?

    /// Key/value storage bridge (App Group UserDefaults).
    var onGetItem: ((String) -> String?)?
    var onSetItem: ((String, String) -> Void)?

    /// Non-fatal JS exceptions (event handlers, timers). Without this,
    /// runtime errors after startup would be silently swallowed.
    var onError: ((String) -> Void)?

    /// WKHapticType name from js/src/haptics.ts.
    var onPlayHaptic: ((String) -> Void)?

    /// Local notifications (js/src/notifications.ts).
    var onRequestNotificationPermission: (() -> Void)?
    var onScheduleNotification: ((String) -> Void)?
    var onCancelNotification: ((String) -> Void)?

    /// WatchConnectivity send (js/src/connectivity.ts).
    var onSendToPhone: ((String) -> Void)?

    /// Async HTTP request (js/src/fetch.ts). Settle with
    /// resolveFetch/rejectFetch on the main thread.
    var onFetch: ((Int, String) -> Void)?
    /// Cancel an in-flight fetch by id.
    var onAbortFetch: ((Int) -> Void)?

    /// CoreBluetooth op channel (js/src/bluetooth.ts): { op, ... }.
    var onBle: ((String) -> Void)?
    /// Sensor op channel (js/src/sensors.ts): { op, kind }.
    var onSensor: ((String) -> Void)?
    /// Persist an OTA JS bundle (js/src/update.ts).
    var onSaveUpdate: ((String) -> Void)?
    /// On-device LLM generate (js/src/ai.ts). Settle with
    /// resolveGenerate/rejectGenerate on the main thread.
    var onGenerate: ((Int, String) -> Void)?

    private let runtime: OpaquePointer
    private let context: OpaquePointer
    private var pendingTimers: [Int32: DispatchWorkItem] = [:]

    init() throws {
        guard let rt = JS_NewRuntime(), let ctx = JS_NewContext(rt) else {
            throw JSError.initialization
        }
        runtime = rt
        context = ctx
        JS_SetContextOpaque(ctx, Unmanaged.passUnretained(self).toOpaque())
        installHostObject()
    }

    deinit {
        pendingTimers.values.forEach { $0.cancel() }
        JS_FreeContext(context)
        JS_FreeRuntime(runtime)
    }

    // MARK: - Public API

    func evaluate(_ code: String, filename: String = "bundle.js") throws {
        let result = code.withCString { codePtr in
            JS_Eval(context, codePtr, strlen(codePtr), filename,
                    qjs_eval_type_global())
        }
        defer { JS_FreeValue(context, result) }
        if JS_IsException(result) != 0 {
            throw JSError.exception(takeExceptionMessage())
        }
        drainJobs()
    }

    /// Loads a precompiled QuickJS bytecode bundle (no parser, faster cold
    /// start). The bytecode must come from the same quickjs-ng version the
    /// app embeds (tools/qjs-compile); callers should fall back to the JS
    /// source if this throws.
    func evaluateBytecode(_ data: Data) throws {
        let fn = data.withUnsafeBytes { raw -> JSValue in
            JS_ReadObject(context, raw.bindMemory(to: UInt8.self).baseAddress,
                          data.count, qjs_read_obj_bytecode())
        }
        if JS_IsException(fn) != 0 {
            throw JSError.exception(takeExceptionMessage())
        }
        let result = JS_EvalFunction(context, fn)
        defer { JS_FreeValue(context, result) }
        if JS_IsException(result) != 0 {
            throw JSError.exception(takeExceptionMessage())
        }
        drainJobs()
    }

    func dispatchEvent(
        nodeId: Int, event: String, payload: [String: Any]? = nil,
        seq: Int? = nil
    ) {
        var payloadArg = "undefined"
        if let payload,
           let data = try? JSONSerialization.data(withJSONObject: payload),
           let json = String(data: data, encoding: .utf8) {
            payloadArg = jsStringLiteral(json)
        }
        var call = "globalThis.__dispatchEvent(\(nodeId), "
            + "\(jsStringLiteral(event)), \(payloadArg)"
        if let seq { call += ", \(seq)" }
        call += ")"
        evaluateReportingErrors(call, filename: "dispatch.js")
    }

    /// Pushes a named native event into JS at urgent priority (runSync), so
    /// the resulting UI update commits immediately. Use for non-interaction
    /// state: connectivity, sensors, app lifecycle.
    /// Settles a JS fetch Promise. MUST be called on the main thread (the
    /// QuickJS context lives there); URLSession completions hop here.
    func resolveFetch(id: Int, responseJson: String) {
        evaluateReportingErrors(
            "globalThis.__resolveFetch(\(id), \(jsStringLiteral(responseJson)))",
            filename: "fetch.js")
    }

    func rejectFetch(id: Int, message: String) {
        evaluateReportingErrors(
            "globalThis.__rejectFetch(\(id), \(jsStringLiteral(message)))",
            filename: "fetch.js")
    }

    func pushNativeEvent(_ name: String, payload: [String: Any]? = nil) {
        var payloadArg = "undefined"
        if let payload,
           let data = try? JSONSerialization.data(withJSONObject: payload),
           let json = String(data: data, encoding: .utf8) {
            payloadArg = jsStringLiteral(json)
        }
        let call = "globalThis.__pushNativeEvent("
            + "\(jsStringLiteral(name)), \(payloadArg))"
        evaluateReportingErrors(call, filename: "push.js")
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
            self.evaluateReportingErrors(
                "globalThis.__fireTimer(\(id))", filename: "timer.js")
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
        while JS_ExecutePendingJob(runtime, &ctx) > 0 {}
    }

    private func takeExceptionMessage() -> String {
        let exception = JS_GetException(context)
        defer { JS_FreeValue(context, exception) }
        var message = "unknown JS exception"
        if let cString = JS_ToCString(context, exception) {
            message = String(cString: cString)
            JS_FreeCString(context, cString)
        }
        // Append the JS stack (QuickJS exposes it on the error object) so
        // the dev overlay shows where it threw, not just the message.
        let stackVal = JS_GetPropertyStr(context, exception, "stack")
        if let stackC = JS_ToCString(context, stackVal) {
            let stack = String(cString: stackC)
            if !stack.isEmpty { message += "\n" + stack }
            JS_FreeCString(context, stackC)
        }
        JS_FreeValue(context, stackVal)
        return message
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
    func resolveGenerate(id: Int, text: String) {
        evaluateReportingErrors(
            "globalThis.__resolveGenerate(\(id), \(jsStringLiteral(text)))",
            filename: "ai.js")
    }
    func rejectGenerate(id: Int, message: String) {
        evaluateReportingErrors(
            "globalThis.__rejectGenerate(\(id), \(jsStringLiteral(message)))",
            filename: "ai.js")
    }
    fileprivate func setItemFromC(_ key: String, _ value: String) {
        onSetItem?(key, value)
    }
    fileprivate func scheduleTimerFromC(id: Int32, milliseconds: Double) {
        scheduleTimer(id: id, milliseconds: milliseconds)
    }
    fileprivate func cancelTimerFromC(id: Int32) { cancelTimer(id: id) }
}
