import Foundation
import ReactWatchCore
import ReactWatchRuntime
import XCTest

// Drives the actual QuickJS embedding (JSRuntime) so the engine and the
// JS -> Swift `__host` bridge are exercised in Swift. Runs on Linux via
// `swift test` and — the reason it exists — on the watchOS simulator via
// `xcodebuild test`, proving the vendored quickjs-ng + Swift host run on the
// real watch architecture. The C-embed and qjs-CLI smokes cover the engine,
// but neither runs the Swift JSRuntime class itself.
final class RuntimeSmokeTests: XCTestCase {
    func testEvaluatesExpressions() throws {
        let runtime = try JSRuntime()
        XCTAssertEqual(runtime.evaluateString("(40 + 2).toString()"), "42")
        XCTAssertTrue(runtime.evaluateBool("1 < 2"))
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
            #"queueMicrotask(() => { throw new Error("microtask boom"); });"#)

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
