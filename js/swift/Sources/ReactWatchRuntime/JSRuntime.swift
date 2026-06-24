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
    /// Move-only owner of the cached native→JS callbacks (freed in deinit,
    /// before the context — see `OwnedCallbacks`).
    private var callbacks = OwnedCallbacks()

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
    }

    deinit {
        pendingTimers.values.forEach { $0.cancel() }
        callbacks.freeAll(in: context)
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

    public func dispatchEvent(
        nodeId: Int, event: String, payload: [String: Any]? = nil,
        seq: Int? = nil
    ) {
        // Pass undefined when the payload holds a type we don't serialize,
        // matching the old JSONSerialization-failure → undefined behavior.
        let payloadValue = payload.flatMap(makeValueOrNil) ?? qjs_undefined()
        let seqValue = seq.map {
            qjs_new_int32(context, Int32(truncatingIfNeeded: $0))
        } ?? qjs_undefined()   // JS branches on `seq === undefined`
        invoke("__dispatchEvent", [
            qjs_new_int32(context, Int32(truncatingIfNeeded: nodeId)),
            JS_NewString(context, event),
            payloadValue,
            seqValue,
        ])
    }

    /// Settles a JS fetch Promise. MUST be called on the main thread (the
    /// QuickJS context lives there); URLSession completions hop here. The
    /// response stays a JSON string — `__resolveFetch` JSON.parses it; we only
    /// drop the per-call `JS_Eval` compilation by invoking through `JS_Call`.
    public func resolveFetch(id: Int, responseJson: String) {
        invoke("__resolveFetch", [
            qjs_new_int32(context, Int32(truncatingIfNeeded: id)),
            JS_NewString(context, responseJson),
        ])
    }

    public func rejectFetch(id: Int, message: String) {
        invoke("__rejectFetch", [
            qjs_new_int32(context, Int32(truncatingIfNeeded: id)),
            JS_NewString(context, message),
        ])
    }

    /// Pushes a named native event into JS at urgent priority (runSync), so
    /// the resulting UI update commits immediately. Use for non-interaction
    /// state: connectivity, sensors, app lifecycle.
    public func pushNativeEvent(_ name: String, payload: [String: Any]? = nil) {
        let payloadValue = payload.flatMap(makeValueOrNil) ?? qjs_undefined()
        invoke("__pushNativeEvent", [
            JS_NewString(context, name), payloadValue,
        ])
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

    /// Calls a cached JS global function with owned argument values. Mirrors
    /// `evaluate`: drains microtasks afterward and routes exceptions to
    /// `onError`. Takes ownership of every value in `args` and frees them; the
    /// cached function reference is borrowed (freed in deinit), not here.
    private func invoke(_ name: String, _ args: [JSValue]) {
        guard let fn = callbacks.resolve(name, in: context) else {
            for arg in args { JS_FreeValue(context, arg) }
            onError?("runtime callback \(name) is not installed")
            return
        }
        var argv = args
        let result = argv.withUnsafeMutableBufferPointer { buffer in
            JS_Call(context, fn, qjs_undefined(),
                    Int32(buffer.count), buffer.baseAddress)
        }
        for arg in args { JS_FreeValue(context, arg) }
        if JS_IsException(result) { onError?(takeExceptionMessage()) }
        JS_FreeValue(context, result)
        drainJobs()
    }

    /// Builds a QuickJS value directly from a Swift value (no JSON round-trip).
    /// Returns nil if any nested leaf is a type we don't serialize, so the
    /// caller can substitute `undefined` — matching the old behavior where
    /// `JSONSerialization` failed and the whole payload became `undefined`.
    /// `JS_SetProperty*` takes ownership of each child, so children added on
    /// success are not freed here; on failure the partial container is freed.
    private func makeValueOrNil(_ any: Any) -> JSValue? {
        switch any {
        case let string as String:
            return JS_NewString(context, string)
        #if canImport(Darwin)
        // On Apple, numbers and bools reach here as NSNumber — both native
        // Swift scalars (bridged) and WatchConnectivity values. CoreFoundation
        // distinguishes a true bool from a numeric (Apple-only, hence the
        // `#if`), restoring the JSONSerialization fidelity the eval-string path
        // had. On Linux the `BinaryInteger`/`BinaryFloatingPoint` cases below
        // cover the native scalars that tests use.
        case let number as NSNumber:
            if CFGetTypeID(number) == CFBooleanGetTypeID() {
                return qjs_new_bool(context, number.boolValue)
            }
            let objCType = number.objCType.pointee
            if objCType == Int8(UInt8(ascii: "f"))
                || objCType == Int8(UInt8(ascii: "d")) {
                return qjs_new_float64(context, number.doubleValue)
            }
            // 64-bit unsigned ("Q"/"L"): int64Value wraps a value above
            // Int64.max (e.g. a UInt64 id; UInt64.max → -1). Use the unsigned
            // value, degrading to a double beyond Int64 as JSON would.
            if objCType == Int8(UInt8(ascii: "Q"))
                || objCType == Int8(UInt8(ascii: "L")) {
                let unsigned = number.uint64Value
                if let exact = Int64(exactly: unsigned) {
                    return qjs_new_int64(context, exact)
                }
                return qjs_new_float64(context, Double(unsigned))
            }
            return qjs_new_int64(context, number.int64Value)
        #endif
        case let bool as Bool:
            return qjs_new_bool(context, bool)
        case let integer as any BinaryInteger:
            // Covers Int / Int8…Int64 / UInt… uniformly; a value outside Int64
            // degrades to a double, as JSON number parsing would.
            if let exact = Int64(exactly: integer) {
                return qjs_new_int64(context, exact)
            }
            return qjs_new_float64(context, Double(integer))
        case let floating as any BinaryFloatingPoint:
            // Covers Double, Float, and CGFloat uniformly. CGFloat is Float on
            // watchOS's arm64_32 slice (Series 8 / SE 2 and older; Series 9/10
            // and Ultra 2/3 moved to 64-bit arm64 in watchOS 26, where it is
            // Double) — apps ship both slices, so `as Double` alone would drop
            // e.g. a drag gesture's x/y on the 32-bit devices.
            return qjs_new_float64(context, Double(floating))
        case let date as Date:
            // No JSON date type; use epoch milliseconds — the convention the
            // app's own date controls already cross the bridge with (NodeView
            // dateBinding). JSONSerialization rejected Date outright.
            return qjs_new_float64(context, date.timeIntervalSince1970 * 1000)
        case let data as Data:
            // Binary has no JSON form; base64 keeps it lossless as a string.
            return JS_NewString(context, data.base64EncodedString())
        case is NSNull:
            return qjs_null()
        case let dictionary as [String: Any]:
            let object = JS_NewObject(context)
            // A failed allocation (OOM under the heap cap) returns an exception
            // and leaves it pending; bail to undefined and clear it rather than
            // build on a poisoned value — matching the old serialization‑failure
            // path, which never touched the runtime's exception state.
            guard !JS_IsException(object) else {
                JS_FreeValue(context, JS_GetException(context))
                return nil
            }
            for (key, value) in dictionary {
                guard let child = makeValueOrNil(value) else {
                    JS_FreeValue(context, object)
                    return nil
                }
                JS_SetPropertyStr(context, object, key, child)
            }
            return object
        case let array as [Any]:
            let jsArray = JS_NewArray(context)
            guard !JS_IsException(jsArray) else {
                JS_FreeValue(context, JS_GetException(context))
                return nil
            }
            for (index, value) in array.enumerated() {
                guard let child = makeValueOrNil(value) else {
                    JS_FreeValue(context, jsArray)
                    return nil
                }
                JS_SetPropertyUint32(context, jsArray, UInt32(index), child)
            }
            return jsArray
        default:
            return nil
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
            self.invoke("__fireTimer", [qjs_new_int32(self.context, id)])
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
    public func resolveGenerate(id: Int, text: String) {
        invoke("__resolveGenerate", [
            qjs_new_int32(context, Int32(truncatingIfNeeded: id)),
            JS_NewString(context, text),
        ])
    }
    public func rejectGenerate(id: Int, message: String) {
        invoke("__rejectGenerate", [
            qjs_new_int32(context, Int32(truncatingIfNeeded: id)),
            JS_NewString(context, message),
        ])
    }
    fileprivate func setItemFromC(_ key: String, _ value: String) {
        onSetItem?(key, value)
    }
    fileprivate func scheduleTimerFromC(id: Int32, milliseconds: Double) {
        scheduleTimer(id: id, milliseconds: milliseconds)
    }
    fileprivate func cancelTimerFromC(id: Int32) { cancelTimer(id: id) }
}

/// Move-only owner of the cached native→JS callback functions. Marked
/// `~Copyable` so the compiler rejects an accidental copy that would later
/// double-free the QuickJS references it holds — the watch analog of Expo's
/// move-only JSI values, applied to QuickJS refcounts. A JSValue cannot
/// outlive its context, so the owner frees this table via `freeAll(in:)`
/// before tearing the context down, rather than from a deinit a class would
/// run only after it had already freed the context.
private struct OwnedCallbacks: ~Copyable {
    private var functions: [String: JSValue] = [:]

    init() {}

    /// Borrows the cached function for `name`, resolving and caching it on
    /// first use. `JS_GetPropertyStr` returns an already-owned reference, so no
    /// extra dup. Returns nil until the bundle has installed the global.
    mutating func resolve(_ name: String, in context: OpaquePointer) -> JSValue? {
        if let cached = functions[name] { return cached }
        let global = JS_GetGlobalObject(context)
        defer { JS_FreeValue(context, global) }
        let fn = JS_GetPropertyStr(context, global, name)
        guard JS_IsFunction(context, fn) else {
            // A throwing getter or OOM makes the lookup raise; clear the
            // pending exception so it can't poison a later JS_Call.
            if JS_IsException(fn) {
                JS_FreeValue(context, JS_GetException(context))
            }
            JS_FreeValue(context, fn)
            return nil
        }
        functions[name] = fn
        return fn
    }

    /// Frees every cached reference. Must run while `context` is still alive.
    mutating func freeAll(in context: OpaquePointer) {
        for fn in functions.values { JS_FreeValue(context, fn) }
        functions.removeAll()
    }
}
