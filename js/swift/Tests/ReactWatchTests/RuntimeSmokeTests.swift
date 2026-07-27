import Foundation
import ReactWatchCore
import ReactWatchRuntime
import XCTest

/// Drives the actual QuickJS embedding (JSRuntime) so the engine and the
/// JS -> Swift `__host` bridge are exercised in Swift. Runs on Linux via
/// `swift test` and — the reason it exists — on the watchOS simulator via
/// `xcodebuild test`, proving the vendored quickjs-ng + Swift host run on the
/// real watch architecture. The C-embed and qjs-CLI smokes cover the engine,
/// but neither runs the Swift JSRuntime class itself.
final class RuntimeSmokeTests: XCTestCase {
    func testEvaluatesExpressions() throws {
        let runtime = try JSRuntime()
        XCTAssertEqual(runtime.evaluateString("(40 + 2).toString()"), "42")
        XCTAssertTrue(runtime.evaluateBool("1 < 2"))
    }

    // ARCH-04: OTA read-only validation (persistOTA) relies on evaluate()
    // throwing for a bundle that fails at load, so a bad bundle is rejected
    // before it's persisted.
    func testEvaluateThrowsOnTopLevelThrow() throws {
        let runtime = try JSRuntime()
        XCTAssertThrowsError(
            try runtime.evaluate("throw new Error('bad bundle')")
        )
    }

    func testHostCommitReachesSwiftAndDecodes() throws {
        let runtime = try JSRuntime()
        var committed: String?
        runtime.bridge.commit = { committed = $0 }

        // JS builds a wire tree and hands it to the native commit bridge,
        // exactly as the React reconciler does at runtime.
        try runtime.evaluate(
            #"""
            __host.commit(JSON.stringify({
              v: 1, seq: 0,
              root: { id: 1, type: "Text", props: { text: "hi from JS" }, children: [] }
            }))
            """#)

        let json = try XCTUnwrap(committed, "the commit bridge never fired")
        let tree = try JSONDecoder().decode(RNTree.self, from: Data(json.utf8))
        XCTAssertEqual(tree.v, RNWire.version)
        let root = try XCTUnwrap(tree.root)
        XCTAssertEqual(root.type, "Text")
        XCTAssertEqual(root.string("text"), "hi from JS")
    }

    // CR-1 / CR-16: async failures must reach onError, not vanish. Before the
    // fix, drainJobs() looped on JS_ExecutePendingJob > 0, ignoring the < 0
    // "a job threw" return, and no promise-rejection tracker was installed —
    // so a throwing microtask or an unhandled rejection was silently dropped.

    func testThrowingMicrotaskReachesOnError() throws {
        let runtime = try JSRuntime()
        var reported: (source: String, message: String)?
        runtime.onError = { reported = ($0, $1) }

        // The throw fires inside a microtask drained by drainJobs(), not at
        // top level (which already rethrew) — exactly the swallowed path.
        try runtime.evaluate(
            #"queueMicrotask(() => { throw new Error("microtask boom"); });"#
        )

        let report = try XCTUnwrap(reported, "throwing microtask never surfaced")
        XCTAssertEqual(report.source, "job")
        XCTAssertTrue(report.message.contains("microtask boom"), "got: \(report.message)")
    }

    func testUnhandledRejectionReachesOnError() throws {
        let runtime = try JSRuntime()
        var reported: (source: String, message: String)?
        runtime.onError = { reported = ($0, $1) }

        // A rejected promise with no .catch — the shape of a rejected fetch or
        // generateText. Surfaced via the host promise-rejection tracker, since
        // a bare rejection never throws at the job level.
        try runtime.evaluate(#"Promise.reject(new Error("rejected boom"));"#)

        let report = try XCTUnwrap(reported, "unhandled rejection never surfaced")
        XCTAssertEqual(report.source, "promiseRejection")
        XCTAssertTrue(report.message.contains("rejected boom"), "got: \(report.message)")
    }

    // ARCH-13: onError tags each report with its entry path so the host can
    // stamp a structured diagnostic code (js.eval/js.call/js.job/
    // js.promiseRejection) without parsing the message.
    func testEvaluateStringExceptionReportsEvalSource() throws {
        let runtime = try JSRuntime()
        var reported: (source: String, message: String)?
        runtime.onError = { reported = ($0, $1) }
        XCTAssertNil(runtime.evaluateString("throw new Error('eval boom')"))
        XCTAssertEqual(reported?.source, "eval")
        XCTAssertTrue(
            reported?.message.contains("eval boom") == true,
            reported?.message ?? "nil")
    }

    // OP-5: a rejected/thrown non-Error value (e.g. `Promise.reject("x")`) has
    // no `.stack`, so describe() must not append a literal "undefined" line.
    func testNonErrorRejectionHasNoUndefinedStack() throws {
        let runtime = try JSRuntime()
        var reported: String?
        runtime.onError = { _, message in reported = message }

        try runtime.evaluate(#"Promise.reject("plain string reason");"#)

        let message = try XCTUnwrap(reported, "rejection never surfaced")
        XCTAssertTrue(message.contains("plain string reason"), "got: \(message)")
        XCTAssertFalse(
            message.contains("undefined"),
            "a non-Error reason must not get a bogus stack: \(message)"
        )
    }

    // OP-4: int args (nodeId/seq) cross as Int64, so a value beyond 2^31 isn't
    // truncated/wrapped on the way into JS.
    func testLargeIntArgIsNotTruncated() throws {
        let runtime = try JSRuntime()
        var committed: String?
        runtime.bridge.commit = { committed = $0 }
        try runtime.evaluate(
            #"""
            globalThis.__dispatchEvent = (nodeId, event, _payload, seq) => {
              __host.commit(JSON.stringify({
                v: 1, seq: seq ?? 0,
                root: { id: nodeId, type: event, props: {}, children: [] }
              }));
              return true;
            };
            """#)

        // Beyond 2^32 — an Int32 cast would wrap this to a small positive id.
        let big = 5_000_000_000
        runtime.dispatchEvent(nodeId: big, event: "Text", seq: 0)

        let json = try XCTUnwrap(committed, "dispatch did not commit")
        let tree = try JSONDecoder().decode(RNTree.self, from: Data(json.utf8))
        XCTAssertEqual(tree.root?.id, big, "large nodeId was truncated")
    }

    // CR-5: the Swift->JS bridge must deliver identical args whether it uses
    // JS_Call (new) or the eval-string path (legacy) — they're A/B-switchable.
    func testDispatchEventEquivalentAcrossBridgePaths() throws {
        for useJSCall in [true, false] {
            let runtime = try JSRuntime()
            runtime.useJSCallBridge = useJSCall
            var committed: String?
            runtime.bridge.commit = { committed = $0 }
            // A fake __dispatchEvent that echoes its args back through the
            // commit bridge, so we can assert the call delivered them.
            try runtime.evaluate(
                #"""
                globalThis.__dispatchEvent = (nodeId, event, payloadJson) => {
                  __host.commit(JSON.stringify({
                    v: 1, seq: 0,
                    root: { id: nodeId, type: event,
                            props: JSON.parse(payloadJson || "{}"), children: [] }
                  }));
                  return true;
                };
                """#)

            runtime.dispatchEvent(nodeId: 7, event: "Text", payload: ["text": "hi"])

            let path = useJSCall ? "JS_Call" : "eval"
            let json = try XCTUnwrap(committed, "\(path) path did not commit")
            let tree = try JSONDecoder().decode(RNTree.self, from: Data(json.utf8))
            XCTAssertEqual(tree.root?.id, 7, "\(path)")
            XCTAssertEqual(tree.root?.type, "Text", "\(path)")
            XCTAssertEqual(tree.root?.string("text"), "hi", "\(path)")
        }
    }

    // ARCH-09: the navigation transaction needs __dispatchEvent's structured
    // JSON verdict back in Swift, synchronously, on both bridge paths.
    func testDispatchEventReturningRoundTripsAcrossBridgePaths() throws {
        for useJSCall in [true, false] {
            let runtime = try JSRuntime()
            runtime.useJSCallBridge = useJSCall
            // Echo the args into the verdict so the assertion proves the
            // payload/seq crossed AND the result string came back intact.
            try runtime.evaluate(
                #"""
                globalThis.__dispatchEvent = (nodeId, event, payloadJson, seq) => {
                  const payload = payloadJson ? JSON.parse(payloadJson) : {};
                  return JSON.stringify({
                    handled: true,
                    accepted: nodeId === 7 && event === "pathChange"
                      && payload.path[0] === "/a" && seq === 3,
                  });
                };
                """#)
            let path = useJSCall ? "JS_Call" : "eval"
            let json = runtime.dispatchEventReturning(
                nodeId: 7, event: "pathChange",
                payloadJson: #"{"path":["/a"]}"#, seq: 3)
            XCTAssertEqual(
                json, #"{"handled":true,"accepted":true}"#, "\(path)")
        }
    }

    func testDispatchEventReturningIsNilWithoutTheGlobal() throws {
        let runtime = try JSRuntime()
        var reported: (source: String, message: String)?
        runtime.onError = { reported = ($0, $1) }
        // No bundle defines __dispatchEvent -> nil (callers parse that to a
        // rollback), and the miss is reported, not crashed on.
        XCTAssertNil(
            runtime.dispatchEventReturning(nodeId: 1, event: "pathChange"))
        XCTAssertEqual(reported?.source, "call")
    }

    // Remote push: the host needs __pushNativeEvent's Bool (did any listener
    // consume the event?) back in Swift to map a background push to
    // WKBackgroundFetchResult .newData/.noData — on both bridge paths.
    func testPushNativeEventReturningRoundTripsAcrossBridgePaths() throws {
        for useJSCall in [true, false] {
            let runtime = try JSRuntime()
            runtime.useJSCallBridge = useJSCall
            // Echo the args into the verdict so the assertion proves the name
            // + JSON payload crossed AND the Bool came back intact.
            try runtime.evaluate(
                #"""
                globalThis.__pushNativeEvent = (name, payloadJson) => {
                  const payload = payloadJson ? JSON.parse(payloadJson) : {};
                  return name === "remotePush"
                    && payload.aps["content-available"] === 1;
                };
                """#)
            let path = useJSCall ? "JS_Call" : "eval"
            XCTAssertTrue(
                runtime.pushNativeEventReturning(
                    "remotePush", payload: ["aps": ["content-available": 1]]),
                "\(path)")
            XCTAssertFalse(
                runtime.pushNativeEventReturning("somethingElse"), "\(path)")
        }
    }

    func testPushNativeEventReturningIsFalseWithoutTheGlobal() throws {
        for useJSCall in [true, false] {
            let runtime = try JSRuntime()
            runtime.useJSCallBridge = useJSCall
            var reported: (source: String, message: String)?
            runtime.onError = { reported = ($0, $1) }
            // No bundle defines __pushNativeEvent -> false (the remote-push
            // delegate reports .noData), and the miss is reported like the
            // void variant, not crashed on.
            XCTAssertFalse(runtime.pushNativeEventReturning("remotePush"))
            XCTAssertEqual(reported?.source, useJSCall ? "call" : "eval")
        }
    }

    func testBridgeCallToMissingFunctionReportsError() throws {
        let runtime = try JSRuntime()
        var reported: (source: String, message: String)?
        runtime.onError = { reported = ($0, $1) }
        // __resolveFetch isn't defined (no bundle) -> JS_Call reports, not crash.
        runtime.resolveFetch(id: 1, responseJson: "{}")
        XCTAssertEqual(reported?.source, "call")
        XCTAssertEqual(reported?.message, "global __resolveFetch is not a function")
    }

    // CR-5: the widget intent path returns Bool/String, also via JS_Call,
    // equivalent across both bridge paths.
    func testCallReturningBoolAndStringAcrossBridgePaths() throws {
        for useJSCall in [true, false] {
            let runtime = try JSRuntime()
            runtime.useJSCallBridge = useJSCall
            try runtime.evaluate(
                #"""
                globalThis.__handleIntent = (name) => name === "go";
                globalThis.__renderWidgets = (ms) => JSON.stringify({ at: ms });
                """#)
            let path = useJSCall ? "JS_Call" : "eval"
            XCTAssertTrue(runtime.callReturningBool("__handleIntent", "go"), "\(path)")
            XCTAssertFalse(runtime.callReturningBool("__handleIntent", "stop"), "\(path)")
            XCTAssertEqual(
                runtime.callReturningString("__renderWidgets", 1000),
                #"{"at":1000}"#, "\(path)"
            )
        }
    }

    // CR-17: the OTA bytecode cache — compile source to bytecode, then a fresh
    // runtime runs it without the parser (and rejects bad source).
    func testCompileToBytecodeRoundTrips() throws {
        let compiler = try JSRuntime()
        let bytecode = try XCTUnwrap(
            compiler.compileToBytecode("globalThis.__x = 41 + 1;"),
            "valid source should compile"
        )

        let runtime = try JSRuntime()
        try runtime.evaluateBytecode(bytecode)
        XCTAssertEqual(runtime.evaluateString("globalThis.__x.toString()"), "42")
    }

    func testCompileToBytecodeReturnsNilOnSyntaxError() throws {
        let runtime = try JSRuntime()
        XCTAssertNil(runtime.compileToBytecode("this is ( not valid"))
    }

    func testCaughtRejectionDoesNotReportError() throws {
        let runtime = try JSRuntime()
        var reported: String?
        runtime.onError = { _, message in reported = message }

        // Handler attached while the promise is still pending (the common
        // fetch().catch() shape): the rejection is handled, so nothing must
        // surface. Guards the tracker against crying wolf on normal code.
        try runtime.evaluate(
            #"""
            var rejectIt;
            const p = new Promise((_resolve, reject) => { rejectIt = reject; });
            p.catch(() => {});
            rejectIt(new Error("handled"));
            """#)

        XCTAssertNil(reported, "a caught rejection must not surface: \(reported ?? "")")
    }

    // M1: entries route onto the runtime's owning queue structurally — a
    // caller on another thread is serialized (sync hop), not left to corrupt
    // the single-threaded engine heap. A widget-target runtime owns a private
    // queue, so this exercises the hop from both the test thread and a
    // background thread.
    func testEntriesFromAnyThreadSerializeOntoOwningQueue() throws {
        let runtime = try JSRuntime(target: .widget)
        // A .widget runtime owns a PRIVATE queue, and this test body runs on
        // the test thread — exactly the release-off-queue shape shutdown()
        // exists for (ARCH-08). Every production owner of a private-queue
        // runtime does the same.
        defer { runtime.shutdown() }
        try runtime.evaluate("globalThis.n = 41")
        let done = expectation(description: "background entry")
        // The runtime is confined by its owning queue, which is exactly what
        // this test proves — hence the launder for the @Sendable closure.
        nonisolated(unsafe) let r = runtime
        DispatchQueue.global().async {
            XCTAssertTrue(r.evaluateBool("++globalThis.n === 42"))
            done.fulfill()
        }
        wait(for: [done], timeout: 5)
        XCTAssertEqual(runtime.evaluateString("globalThis.n.toString()"), "42")
    }

    // M1: timers fire on the OWNING queue, not main — the widget hazard was a
    // non-main runtime's timer delivering __fireTimer on the main thread
    // against a context that lives (and may die) elsewhere.
    func testTimerFiresOnTheOwningQueue() throws {
        let queue = DispatchQueue(label: "test.owning-queue")
        let marker = DispatchSpecificKey<Bool>()
        queue.setSpecific(key: marker, value: true)
        let runtime = try JSRuntime(queue: queue)
        defer { runtime.shutdown() }

        let fired = expectation(description: "timer fired")
        nonisolated(unsafe) var onOwningQueue: Bool?
        runtime.bridge.log = { _ in
            onOwningQueue = DispatchQueue.getSpecific(key: marker) ?? false
            fired.fulfill()
        }
        try runtime.evaluate(
            #"""
            globalThis.__fireTimer = (id) => { __host.log("fired " + id); };
            __host.setTimer(7, 10);
            """#)
        wait(for: [fired], timeout: 5)
        XCTAssertEqual(onOwningQueue, true, "timer must deliver on the owning queue")
    }

    // M2: a host handler that settles an invoke INLINE (on the C-trampoline
    // stack) re-enters JS while the outer statement is still suspended. The
    // nested call is by design — but draining the MICROTASK queue there
    // executed queued React work mid-statement, breaking run-to-completion.
    // Jobs must run only when the outermost entry exits.
    func testInlineInvokeSettleDoesNotDrainJobsMidStatement() throws {
        let runtime = try JSRuntime()
        runtime.bridge.invoke = { id, _, _ in
            // Synchronous inline settle — the exact shape of getDeviceInfo,
            // keychain, waterlock, saveUpdate…
            runtime.resolveInvoke(id: id, resultJson: "null")
        }
        try runtime.evaluate(
            #"""
            globalThis.order = [];
            globalThis.__resolveInvoke = (id) => { order.push("resolve:" + id); };
            Promise.resolve().then(() => order.push("microtask"));
            __host.invoke(1, "m", "{}");
            order.push("after-invoke");
            """#)
        // The microtask runs AFTER the whole statement — not between the
        // inline settle and the next line.
        XCTAssertEqual(
            runtime.evaluateString("JSON.stringify(order)"),
            #"["resolve:1","after-invoke","microtask"]"#)
    }

    // MARK: - ARCH-08: queue-confined shutdown

    // The reason shutdown() exists. `deinit` runs on whatever thread drops the
    // last reference — for the OTA validator/compiler and the widget runtime
    // that is a WidgetKit/staging thread, NOT the runtime's private owning
    // queue. A bundle whose module init arms a setTimeout leaves a live
    // DispatchSourceTimer on that queue, so freeing the engine from the other
    // thread raced the timer handler (which mutates the same pendingTimers
    // dictionary and re-enters the context via __fireTimer): a data race plus
    // a use-after-free reachable from a signed-but-hostile OTA bundle.
    // shutdown() cancels the timer ON the owning queue, so the handler has
    // either fully run before it or never runs at all.
    func testShutdownFromAnotherThreadCancelsAnArmedTimer() throws {
        let queue = DispatchQueue(label: "test.ota-validate")
        let runtime = try JSRuntime(queue: queue)
        nonisolated(unsafe) var fires = 0
        nonisolated(unsafe) var refusals: [String] = []
        runtime.bridge.log = { _ in fires += 1 }
        runtime.onError = { source, message in
            if source == "shutdown" { refusals.append(message) }
        }
        // Exactly the staged-bundle shape: a timer armed during evaluate().
        try runtime.evaluate(
            #"""
            globalThis.__fireTimer = (id) => { __host.log("fired " + id); };
            __host.setTimer(1, 20);
            """#)

        nonisolated(unsafe) let r = runtime
        let done = expectation(description: "shut down off-queue")
        DispatchQueue.global().async {
            r.shutdown()
            done.fulfill()
        }
        wait(for: [done], timeout: 5)

        // Well past the 20ms deadline (plus its leeway): the source was
        // cancelled on the owning queue, so __fireTimer never ran.
        let settled = expectation(description: "deadline passed")
        queue.asyncAfter(deadline: .now() + 0.2) { settled.fulfill() }
        wait(for: [settled], timeout: 5)
        XCTAssertEqual(fires, 0, "a cancelled timer must not fire after shutdown")
        // The source was CANCELLED, not merely refused at the JS entry: a
        // handler that still ran would have been turned away by the
        // use-after-shutdown guard and reported here. On device that handler
        // would be racing JS_FreeRuntime on another thread, which no entry
        // guard can save us from — the cancel is the actual fix.
        XCTAssertEqual(refusals, [], "the timer source itself must be cancelled")
    }

    // Idempotent, and safe to call from the owning queue after an off-queue
    // shutdown — the deinit that follows must find nothing left to free rather
    // than double-freeing the context.
    func testShutdownIsIdempotent() throws {
        let runtime = try JSRuntime(queue: DispatchQueue(label: "test.shutdown"))
        try runtime.evaluate("globalThis.n = 1")
        runtime.shutdown()
        runtime.shutdown()
        runtime.shutdown()
    }

    // Rule 12: an entry after shutdown is a bug at the CALL SITE (every site
    // drops its runtime immediately after shutting it down), so it must report
    // rather than quietly return a default — and above all must not dereference
    // the freed context.
    func testEntriesAfterShutdownFailLoudly() throws {
        let runtime = try JSRuntime(queue: DispatchQueue(label: "test.after"))
        try runtime.evaluate("globalThis.n = 1")
        nonisolated(unsafe) var reported: [String] = []
        runtime.onError = { source, message in reported.append("\(source):\(message)") }
        runtime.shutdown()

        XCTAssertThrowsError(try runtime.evaluate("globalThis.n = 2")) { error in
            guard case JSRuntime.JSError.shutdown = error else {
                return XCTFail("expected .shutdown, got \(error)")
            }
        }
        XCTAssertFalse(runtime.evaluateBool("true"))
        XCTAssertNil(runtime.evaluateString("'x'"))
        XCTAssertNil(runtime.compileToBytecode("1 + 1"))
        // The JS_Call bridge (dispatchEvent/push/resolve*/reject*) refuses too.
        XCTAssertFalse(runtime.pushNativeEventReturning("anything"))
        XCTAssertNil(runtime.dispatchEventReturning(nodeId: 1, event: "press"))
        XCTAssertEqual(reported.count, 6, "each refused entry reports once: \(reported)")
        XCTAssertTrue(reported.allSatisfy { $0.hasPrefix("shutdown:") })
    }

    // ARCH-08 follow-up: shutdown() from INSIDE a live JS entry.
    // A shutdown() from a bridge closure runs on the owning queue with JS_Eval
    // live on the C stack. Freeing there aborted in JS_FreeRuntime.
    func testShutdownFromInsideLiveJSEntryIsDeferred() throws {
        let runtime = try JSRuntime(queue: DispatchQueue(label: "t.entry"))
        nonisolated(unsafe) let r = runtime
        nonisolated(unsafe) var refusals: [String] = []
        r.onError = { source, message in
            if source == "shutdown" { refusals.append(message) }
        }
        r.bridge.log = { _ in r.shutdown() }
        try r.evaluate(#"""
            __host.log("x");
            let s = null;
            for (let i = 0; i < 20000; i++) { s = { i, s: String(i) }; }
            globalThis.after = s.i;
        """#)
        // The entry that requested the shutdown ran to completion...
        XCTAssertEqual(refusals, [])
        // ...and the free happened on the way out, so the next entry refuses.
        XCTAssertThrowsError(try r.evaluate("globalThis.n = 1")) { error in
            guard case JSRuntime.JSError.shutdown = error else {
                return XCTFail("expected .shutdown, got \(error)")
            }
        }
        r.shutdown()
    }

    // The microtask drain runs at jsEntryDepth 0 by construction, so a depth
    // check alone does not cover a host closure reached from a job.
    func testShutdownFromInsideDrainJobsIsDeferred() throws {
        let runtime = try JSRuntime(queue: DispatchQueue(label: "t.drain"))
        nonisolated(unsafe) let r = runtime
        r.bridge.log = { _ in r.shutdown() }
        try r.evaluate(#"""
            Promise.resolve().then(() => {
              __host.log("m");
              let s = null;
              for (let i = 0; i < 20000; i++) { s = { i, s: String(i) }; }
              globalThis.after = s.i;
            });
        """#)
        XCTAssertFalse(r.evaluateBool("true"), "runtime must be shut down by now")
        r.shutdown()
    }

    // The deferred free must actually happen — a request from inside JS that
    // only ever set a flag would leak the engine and its armed timers.
    func testDeferredShutdownStillCancelsAnArmedTimer() throws {
        let queue = DispatchQueue(label: "t.timer")
        let runtime = try JSRuntime(queue: queue)
        nonisolated(unsafe) let r = runtime
        nonisolated(unsafe) var fires = 0
        r.bridge.log = { message in
            if message == "shutdown-now" { r.shutdown() } else { fires += 1 }
        }
        try r.evaluate(#"""
            globalThis.__fireTimer = (id) => { __host.log("fired " + id); };
            __host.setTimer(1, 20);
            __host.log("shutdown-now");
        """#)
        let settled = expectation(description: "deadline passed")
        queue.asyncAfter(deadline: .now() + 0.2) { settled.fulfill() }
        wait(for: [settled], timeout: 5)
        XCTAssertEqual(fires, 0, "the armed timer must have been cancelled")
    }

    // The DEBUG assertion in deinit fires when a runtime is released off its
    // owning queue WITHOUT a prior shutdown. The passing path — shut down from
    // any thread first, then let ARC drop it from anywhere — must stay quiet,
    // which is what every call site relies on (`defer { validator.shutdown() }`,
    // WidgetIntentRuntime.deinit, boot()'s `runtime?.shutdown()`).
    func testReleaseAfterShutdownIsQuietFromAnyThread() throws {
        let done = expectation(description: "released off-queue")
        DispatchQueue.global().async {
            // Created AND released on a thread that is not the owning queue —
            // the OTA-validator shape.
            let runtime = try? JSRuntime(queue: DispatchQueue(label: "test.release"))
            runtime?.shutdown()
            done.fulfill()
        }
        wait(for: [done], timeout: 5)
    }
}
