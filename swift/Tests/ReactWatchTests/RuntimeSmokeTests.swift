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

    // The native->JS bridge now hands callbacks a structured object (built by
    // JSRuntime.makeValueOrNil + JS_Call), not a JSON string. These pin that
    // contract: the JS side dropped its JSON.parse, so a regression to the old
    // eval-string path would surface here.

    func testPushNativeEventDeliversStructuredObject() throws {
        let runtime = try JSRuntime()
        // Stand in for the bundle's global: record what JS actually receives.
        try runtime.evaluate(#"""
        globalThis.__pushNativeEvent = (name, payload) => {
          globalThis.__name = name;
          globalThis.__payload = payload;
          return true;
        };
        """#)

        runtime.pushNativeEvent("sensor.heartRate", payload: ["bpm": 72])

        XCTAssertEqual(
            runtime.evaluateString("globalThis.__name"), "sensor.heartRate")
        // An object, not the old JSON string.
        XCTAssertEqual(
            runtime.evaluateString("typeof globalThis.__payload"), "object")
        XCTAssertEqual(
            runtime.evaluateString("String(globalThis.__payload.bpm)"), "72")
    }

    func testDispatchEventPassesObjectPayloadAndNumericSeq() throws {
        let runtime = try JSRuntime()
        try runtime.evaluate(#"""
        globalThis.__dispatchEvent = (nodeId, event, payload, seq) => {
          globalThis.__d = {
            nodeId, event,
            payloadType: typeof payload,
            value: payload ? payload.value : null,
            seqType: typeof seq,
          };
          return true;
        };
        """#)

        runtime.dispatchEvent(
            nodeId: 7, event: "change", payload: ["value": true], seq: 3)

        XCTAssertEqual(runtime.evaluateString("String(globalThis.__d.nodeId)"), "7")
        XCTAssertEqual(runtime.evaluateString("globalThis.__d.event"), "change")
        XCTAssertEqual(
            runtime.evaluateString("globalThis.__d.payloadType"), "object")
        XCTAssertEqual(
            runtime.evaluateString("String(globalThis.__d.value)"), "true")
        XCTAssertEqual(
            runtime.evaluateString("String(globalThis.__d.seqType)"), "number")
    }

    func testDispatchEventOmitsAbsentSeqAndDropsUnserializablePayload() throws {
        let runtime = try JSRuntime()
        try runtime.evaluate(#"""
        globalThis.__dispatchEvent = (nodeId, event, payload, seq) => {
          globalThis.__seqUndefined = seq === undefined;
          globalThis.__payloadUndefined = payload === undefined;
          return true;
        };
        """#)

        // No seq → JS must still see `seq === undefined` (the ack branch). A
        // Date is not serializable, so the whole payload collapses to
        // undefined — exactly what the old JSONSerialization-failure path did.
        runtime.dispatchEvent(nodeId: 1, event: "press", payload: ["at": Date()])

        XCTAssertEqual(
            runtime.evaluateString("String(globalThis.__seqUndefined)"), "true")
        XCTAssertEqual(
            runtime.evaluateString("String(globalThis.__payloadUndefined)"), "true")
    }
}
