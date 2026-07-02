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

    /// Every synchronous `__host` callback, GENERATED from codegen/schema.mjs
    /// (CX-023): the embedding host sets the feature closures (commit,
    /// publishWidgets, getItem/setItem, counters, playHaptic, invoke,
    /// cancelNotification, fetch/abortFetch, ble, sensor, generate); JSRuntime
    /// sets the infra ones (setTimer/clearTimer/log) to internal defaults in
    /// `installHostObject`. The generated C trampolines dispatch into this.
    public var bridge = HostBridge()

    /// Non-fatal JS exceptions (event handlers, timers) — reported to the host,
    /// not called FROM JS, so it isn't part of the generated `__host` surface.
    /// Without this, runtime errors after startup would be silently swallowed.
    public var onError: ((String) -> Void)?

    private let runtime: OpaquePointer
    private let context: OpaquePointer
    /// Which embedding this runtime is — selects which host functions get
    /// installed on `__host` (the widget extension omits the watch-only ones).
    private let target: HostTarget
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

    /// - Parameters:
    ///   - memoryLimitBytes: caps the QuickJS heap (the widget extension runs in
    ///     a tight ~30MB budget; nil = unlimited).
    ///   - target: which embedding this is. Defaults to `.watch` (the full app);
    ///     the widget extension passes `.widget` so only the host functions it
    ///     backs are installed on `__host`.
    public init(memoryLimitBytes: Int? = nil, target: HostTarget = .watch) throws {
        guard let rt = JS_NewRuntime(), let ctx = JS_NewContext(rt) else {
            throw JSError.initialization
        }
        runtime = rt
        context = ctx
        self.target = target
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
            JS_Eval(
                context, codePtr, strlen(codePtr), filename,
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
            JS_ReadObject(
                context, raw.bindMemory(to: UInt8.self).baseAddress,
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
            JS_Eval(
                context, ptr, strlen(ptr), "bundle.js",
                qjs_eval_flag_compile_only())
        }
        defer { JS_FreeValue(context, compiled) }
        if JS_IsException(compiled) { return nil }
        var size = 0
        guard
            let buf = JS_WriteObject(
                context, &size, compiled, qjs_write_obj_bytecode()
            )
        else { return nil }
        defer { js_free(context, buf) }
        return Data(bytes: buf, count: size)
    }

    public func dispatchEvent(
        nodeId: Int, event: String, payload: [String: Any]? = nil,
        seq: Int? = nil
    ) {
        assertMainThread()
        var args: [JSArg] = [
            .int(nodeId), .string(event), .jsonOrUndefined(jsonString(payload)),
        ]
        if let seq { args.append(.int(seq)) }
        bridgeCall("__dispatchEvent", args, filename: "dispatch.js")
    }

    /// QuickJS is single-threaded — every method that touches the JS context
    /// (the Promise settles, plus the event-push/dispatch calls) MUST run on the
    /// main thread (OP-2). This DEBUG assertion catches a background-thread call
    /// (a URLSession/WCSession/CoreBluetooth/Task callback that forgot to hop to
    /// main) before it corrupts the engine heap; release builds are unaffected.
    /// `#function` defaults to the *caller*, so the trap names the offending
    /// method. All current callers were audited on-main (connectivity + sensors
    /// hop to main explicitly; the BLE central uses `queue: nil` → main; UI /
    /// scenePhase / openURL run on the SwiftUI main thread).
    private func assertMainThread(_ caller: StaticString = #function) {
        assert(
            Thread.isMainThread,
            "JSRuntime.\(caller) must be called on the main thread (QuickJS is "
                + "single-threaded); hop to DispatchQueue.main / MainActor first.")
    }

    /// Settles a JS fetch Promise. MUST be called on the main thread (the
    /// QuickJS context lives there); URLSession completions hop here.
    public func resolveFetch(id: Int, responseJson: String) {
        assertMainThread()
        bridgeCall(
            "__resolveFetch", [.int(id), .string(responseJson)],
            filename: "fetch.js")
    }

    public func rejectFetch(id: Int, message: String) {
        assertMainThread()
        bridgeCall(
            "__rejectFetch", [.int(id), .string(message)],
            filename: "fetch.js")
    }

    /// Settles a generic invoke Promise (SD-1) with the op's JSON result. Call
    /// on the main thread. resultJson must be valid JSON ("" → undefined in JS).
    public func resolveInvoke(id: Int, resultJson: String) {
        assertMainThread()
        bridgeCall(
            "__resolveInvoke", [.int(id), .string(resultJson)],
            filename: "invoke.js")
    }

    /// Rejects a generic invoke Promise with a typed reason (errorJson =
    /// {code, message}), so the caller surfaces *why* it failed (SD-1).
    public func rejectInvoke(id: Int, errorJson: String) {
        assertMainThread()
        bridgeCall(
            "__rejectInvoke", [.int(id), .string(errorJson)],
            filename: "invoke.js")
    }

    /// Pushes a named native event into JS at urgent priority (runSync), so
    /// the resulting UI update commits immediately. Use for non-interaction
    /// state: connectivity, sensors, app lifecycle.
    public func pushNativeEvent(_ name: String, payload: [String: Any]? = nil) {
        assertMainThread()
        bridgeCall(
            "__pushNativeEvent",
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
            let cString = JS_ToCString(context, result)
        else {
            onError?(takeExceptionMessage())
            return nil
        }
        defer { JS_FreeCString(context, cString) }
        return String(cString: cString)
    }

    private func evaluateReportingErrors(_ code: String, filename: String) {
        do {
            try evaluate(code, filename: filename)
        } catch let JSError.exception(message) {
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
        // Int64, not Int32: nodeId/seq are monotonic and a long session could
        // exceed 2^31 — truncating would wrap an id and mis-route an event/ack
        // (OP-4). JS represents it exactly up to 2^53.
        case .int(let n): JS_NewInt64(context, Int64(n))
        case .double(let d): JS_NewFloat64(context, d)
        case .string(let s): JS_NewString(context, s)
        case .jsonOrUndefined(let s):
            s.map { JS_NewString(context, $0) } ?? qjs_undefined()
        }
    }

    private func renderArg(_ arg: JSArg) -> String {
        switch arg {
        case .int(let n): "\(n)"
        case .double(let d): "\(d)"
        case .string(let s): jsStringLiteral(s)
        case .jsonOrUndefined(let s): s.map(jsStringLiteral) ?? "undefined"
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
    /// ASSUMES bundle globals are set once at eval and never reassigned — a
    /// bundle (or future HMR shim) that reassigns e.g. `__dispatchEvent` after
    /// first use would keep dispatching to the stale function (NF review note).
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

        // Infra callbacks the runtime owns, not the embedding host: timer
        // scheduling + logging. Set before the bundle runs; a host may override.
        bridge.setTimer = { [weak self] id, ms in
            self?.scheduleTimer(id: Int32(id), milliseconds: ms)
        }
        bridge.clearTimer = { [weak self] id in self?.cancelTimer(id: Int32(id)) }
        bridge.log = { print("[js]", $0) }

        let host = JS_NewObject(context)
        // Every direct host function for this target is installed from the schema
        // (CX-023); the widget omits the watch-only ones it can't back.
        installHostBridge(into: host, context: context, target: target)
        // JS_SetPropertyStr takes ownership of `host`.
        JS_SetPropertyStr(context, global, "__host", host)
    }

    private func scheduleTimer(id: Int32, milliseconds: Double) {
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            pendingTimers[id] = nil
            bridgeCall("__fireTimer", [.int(Int(id))], filename: "timer.js")
        }
        pendingTimers[id] = work
        DispatchQueue.main.asyncAfter(
            deadline: .now() + milliseconds / 1000.0, execute: work
        )
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
        let data =
            (try? JSONSerialization.data(
                withJSONObject: [value]
            )) ?? Data("[\"\"]".utf8)
        let array = String(data: data, encoding: .utf8) ?? "[\"\"]"
        return String(array.dropFirst().dropLast())
    }

    static func from(context: OpaquePointer?) -> JSRuntime? {
        guard let context, let opaque = JS_GetContextOpaque(context) else {
            return nil
        }
        return Unmanaged<JSRuntime>.fromOpaque(opaque).takeUnretainedValue()
    }
}

// @convention(c) callbacks cannot capture state; the owning JSRuntime is
// recovered through the context opaque pointer.

/// quickjs-ng calls this whenever a promise's rejection-handled state changes.
/// We act only on the "no handler" edge (isHandled == false); the matching
/// isHandled == true callback (a late .catch) is ignored. Report-only, like
/// quickjs-ng's own CLI tracker.
private func promiseRejectionTracker(
    ctx: OpaquePointer?, promise _: JSValue, reason: JSValue,
    isHandled: Bool, opaque _: UnsafeMutableRawPointer?
) {
    guard !isHandled, let runtime = JSRuntime.from(context: ctx) else { return }
    runtime.reportUnhandledRejection(reason)
}

// MARK: - Swift -> JS settle (generate)

extension JSRuntime {
    /// Settles a generateText Promise on the main thread (where the context
    /// lives). resolve/reject are Swift -> JS, so they aren't part of the
    /// generated JS -> Swift `__host` bridge.
    public func resolveGenerate(id: Int, text: String) {
        assertMainThread()
        bridgeCall("__resolveGenerate", [.int(id), .string(text)], filename: "ai.js")
    }

    public func rejectGenerate(id: Int, message: String) {
        assertMainThread()
        bridgeCall("__rejectGenerate", [.int(id), .string(message)], filename: "ai.js")
    }
}
