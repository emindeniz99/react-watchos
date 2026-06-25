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
        runtime.onCommit = { committed = $0 }

        // JS builds a wire tree and hands it to the native commit bridge,
        // exactly as the React reconciler does at runtime.
        try runtime.evaluate(#"""
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
        var reported: String?
        runtime.onError = { reported = $0 }

        // The throw fires inside a microtask drained by drainJobs(), not at
        // top level (which already rethrew) — exactly the swallowed path.
        try runtime.evaluate(
            #"queueMicrotask(() => { throw new Error("microtask boom"); });"#
        )

        let message = try XCTUnwrap(reported, "throwing microtask never surfaced")
        XCTAssertTrue(message.contains("microtask boom"), "got: \(message)")
    }

    func testUnhandledRejectionReachesOnError() throws {
        let runtime = try JSRuntime()
        var reported: String?
        runtime.onError = { reported = $0 }

        // A rejected promise with no .catch — the shape of a rejected fetch or
        // generateText. Surfaced via the host promise-rejection tracker, since
        // a bare rejection never throws at the job level.
        try runtime.evaluate(#"Promise.reject(new Error("rejected boom"));"#)

        let message = try XCTUnwrap(reported, "unhandled rejection never surfaced")
        XCTAssertTrue(message.contains("rejected boom"), "got: \(message)")
    }

    // OP-5: a rejected/thrown non-Error value (e.g. `Promise.reject("x")`) has
    // no `.stack`, so describe() must not append a literal "undefined" line.
    func testNonErrorRejectionHasNoUndefinedStack() throws {
        let runtime = try JSRuntime()
        var reported: String?
        runtime.onError = { reported = $0 }

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
        runtime.onCommit = { committed = $0 }
        try runtime.evaluate(#"""
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
            runtime.onCommit = { committed = $0 }
            // A fake __dispatchEvent that echoes its args back through the
            // commit bridge, so we can assert the call delivered them.
            try runtime.evaluate(#"""
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

    func testBridgeCallToMissingFunctionReportsError() throws {
        let runtime = try JSRuntime()
        var reported: String?
        runtime.onError = { reported = $0 }
        // __resolveFetch isn't defined (no bundle) -> JS_Call reports, not crash.
        runtime.resolveFetch(id: 1, responseJson: "{}")
        XCTAssertEqual(reported, "global __resolveFetch is not a function")
    }

    // CR-5: the widget intent path returns Bool/String, also via JS_Call,
    // equivalent across both bridge paths.
    func testCallReturningBoolAndStringAcrossBridgePaths() throws {
        for useJSCall in [true, false] {
            let runtime = try JSRuntime()
            runtime.useJSCallBridge = useJSCall
            try runtime.evaluate(#"""
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
        runtime.onError = { reported = $0 }

        // Handler attached while the promise is still pending (the common
        // fetch().catch() shape): the rejection is handled, so nothing must
        // surface. Guards the tracker against crying wolf on normal code.
        try runtime.evaluate(#"""
        var rejectIt;
        const p = new Promise((_resolve, reject) => { rejectIt = reject; });
        p.catch(() => {});
        rejectIt(new Error("handled"));
        """#)

        XCTAssertNil(reported, "a caught rejection must not surface: \(reported ?? "")")
    }
}
