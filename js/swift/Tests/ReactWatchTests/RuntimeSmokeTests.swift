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

/// A type with no JSON / property-list representation, used to exercise the
/// `makeValueOrNil` fallback (genuinely unmappable values → `undefined`).
private struct Unmappable {}

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

    func testDispatchEventOmitsAbsentSeqAndDropsUnmappablePayload() throws {
        let runtime = try JSRuntime()
        try runtime.evaluate(#"""
        globalThis.__dispatchEvent = (nodeId, event, payload, seq) => {
          globalThis.__seqUndefined = seq === undefined;
          globalThis.__payloadUndefined = payload === undefined;
          return true;
        };
        """#)

        // No seq → JS must still see `seq === undefined` (the ack branch). A
        // value with no JSON/property-list form collapses the whole payload to
        // undefined — exactly what the old JSONSerialization-failure path did.
        runtime.dispatchEvent(
            nodeId: 1, event: "press", payload: ["bad": Unmappable()])

        XCTAssertEqual(
            runtime.evaluateString("String(globalThis.__seqUndefined)"), "true")
        XCTAssertEqual(
            runtime.evaluateString("String(globalThis.__payloadUndefined)"), "true")
    }

    func testPushNativeEventEncodesEveryNumericPayloadType() throws {
        let runtime = try JSRuntime()
        try runtime.evaluate(#"""
        globalThis.__pushNativeEvent = (name, p) => {
          globalThis.__p = p;
          return true;
        };
        """#)

        // Mixed integer widths, Float, Double, and Bool each reach JS as the
        // right primitive. The BinaryInteger/BinaryFloatingPoint cases also
        // cover Float/CGFloat, which a plain `as Double` would have dropped.
        runtime.pushNativeEvent("nums", payload: [
            "i": 42,
            "big": Int64(1_700_000_000_000),
            "f": Float(1.5),
            "d": 3.25,
            "flag": true,
        ])

        XCTAssertEqual(runtime.evaluateString("typeof globalThis.__p"), "object")
        XCTAssertEqual(runtime.evaluateString("String(globalThis.__p.i)"), "42")
        XCTAssertEqual(
            runtime.evaluateString("String(globalThis.__p.big)"), "1700000000000")
        XCTAssertEqual(runtime.evaluateString("String(globalThis.__p.f)"), "1.5")
        XCTAssertEqual(runtime.evaluateString("String(globalThis.__p.d)"), "3.25")
        XCTAssertEqual(
            runtime.evaluateString("typeof globalThis.__p.flag"), "boolean")
    }

    func testPushNativeEventEncodesNestedContainers() throws {
        let runtime = try JSRuntime()
        try runtime.evaluate(#"""
        globalThis.__pushNativeEvent = (name, p) => {
          globalThis.__p = p;
          return true;
        };
        """#)

        // Dictionaries and arrays nest recursively, and the primitives inside
        // them survive — the manual mapping mirrors what JSON.parse would build.
        runtime.pushNativeEvent("nested", payload: [
            "items": [
                ["id": 1, "on": true],
                ["id": 2, "on": false],
            ],
            "meta": ["count": 2, "label": "list"],
            "tags": ["a", "b", "c"],
        ])

        XCTAssertEqual(
            runtime.evaluateString("String(Array.isArray(globalThis.__p.items))"),
            "true")
        XCTAssertEqual(
            runtime.evaluateString("String(globalThis.__p.items.length)"), "2")
        XCTAssertEqual(
            runtime.evaluateString("String(globalThis.__p.items[0].id)"), "1")
        XCTAssertEqual(
            runtime.evaluateString("typeof globalThis.__p.items[1].on"), "boolean")
        XCTAssertEqual(
            runtime.evaluateString("String(globalThis.__p.meta.count)"), "2")
        XCTAssertEqual(
            runtime.evaluateString("globalThis.__p.meta.label"), "list")
        XCTAssertEqual(
            runtime.evaluateString("globalThis.__p.tags.join(',')"), "a,b,c")
    }

    func testPushNativeEventEncodesDateAndData() throws {
        let runtime = try JSRuntime()
        try runtime.evaluate(#"""
        globalThis.__pushNativeEvent = (name, p) => {
          globalThis.__p = p;
          return true;
        };
        """#)

        // The last two property-list types: Date → epoch ms (the app's date
        // convention), Data → lossless base64. Reachable only from a
        // WatchConnectivity message, but now mapped rather than dropped.
        runtime.pushNativeEvent("io", payload: [
            "ts": Date(timeIntervalSince1970: 1_700_000_000),
            "blob": Data([1, 2, 3]),
        ])

        XCTAssertEqual(
            runtime.evaluateString("String(globalThis.__p.ts)"), "1700000000000")
        XCTAssertEqual(runtime.evaluateString("globalThis.__p.blob"), "AQID")
    }

    func testPushNativeEventKeepsLargeUnsignedPositive() throws {
        let runtime = try JSRuntime()
        try runtime.evaluate(#"""
        globalThis.__pushNativeEvent = (name, p) => {
          globalThis.__p = p;
          return true;
        };
        """#)

        // A UInt64 above Int64.max must stay positive — a naive int64 cast
        // would wrap it negative. It degrades to a double beyond 2^53, as JSON
        // number parsing would. (On Apple the NSNumber "Q"/"L" branch mirrors
        // this; here the BinaryInteger path exercises the same intent.)
        runtime.pushNativeEvent("ids", payload: ["id": UInt64.max])

        XCTAssertEqual(
            runtime.evaluateString("String(globalThis.__p.id > 0)"), "true")
        XCTAssertEqual(
            runtime.evaluateString("String(globalThis.__p.id)"),
            "18446744073709552000")
    }

    func testPushNativeEventPreservesEmbeddedNulInStrings() throws {
        let runtime = try JSRuntime()
        try runtime.evaluate(#"""
        globalThis.__pushNativeEvent = (name, p) => {
          globalThis.__s = p.s;
          return true;
        };
        """#)

        // A string with an embedded NUL must survive whole — a Swift String →
        // C string cast truncates at the NUL, which the old JSON path did not.
        runtime.pushNativeEvent("nul", payload: ["s": "a\u{0}b"])

        XCTAssertEqual(runtime.evaluateString("String(globalThis.__s.length)"), "3")
        XCTAssertEqual(
            runtime.evaluateString("String(globalThis.__s.charCodeAt(1))"), "0")
    }

    func testDispatchEventDoesNotTruncateLargeNodeIdOrSeq() throws {
        let runtime = try JSRuntime()
        try runtime.evaluate(#"""
        globalThis.__dispatchEvent = (nodeId, event, payload, seq) => {
          globalThis.__nid = nodeId;
          globalThis.__seq = seq;
          return true;
        };
        """#)

        // A nodeId/seq above Int32 must not silently wrap — the old string-built
        // call emitted the full value; an int32 cast would corrupt it.
        let big = 1 << 40  // 1,099,511,627,776 — exceeds Int32, fits float64
        runtime.dispatchEvent(nodeId: big, event: "x", seq: big + 1)

        XCTAssertEqual(
            runtime.evaluateString("String(globalThis.__nid)"), "1099511627776")
        XCTAssertEqual(
            runtime.evaluateString("String(globalThis.__seq)"), "1099511627777")
    }

    func testPushNativeEventDropsNonFinitePayload() throws {
        let runtime = try JSRuntime()
        try runtime.evaluate(#"""
        globalThis.__pushNativeEvent = (name, p) => {
          globalThis.__pUndefined = p === undefined;
          return true;
        };
        """#)

        // A non-finite float has no JSON form — JSONSerialization rejected it,
        // so the old path dropped the whole payload to undefined. The direct
        // mapping must do the same, not leak a live JS NaN/Infinity (which
        // JSON.stringify would silently mask as null). One bad leaf collapses
        // the whole payload, exactly like the unmappable-type case.
        runtime.pushNativeEvent("nan", payload: ["x": Double.nan])
        XCTAssertEqual(
            runtime.evaluateString("String(globalThis.__pUndefined)"), "true")

        runtime.pushNativeEvent(
            "inf", payload: ["ok": 1, "bad": Double.infinity])
        XCTAssertEqual(
            runtime.evaluateString("String(globalThis.__pUndefined)"), "true")
    }

    func testThrowingMicrotaskIsReportedAndDoesNotPoisonNextCall() throws {
        let runtime = try JSRuntime()
        var errors: [String] = []
        runtime.onError = { errors.append($0) }

        // A native->JS callback that schedules a microtask which throws. A raw
        // queueMicrotask job (unlike a `.then`, whose throw is captured into a
        // rejected promise) surfaces the throw through JS_ExecutePendingJob as a
        // job error. The old drain loop stopped on that, left the exception
        // pending, swallowed the error, and poisoned the *next* JS_Call.
        // Draining must report it (so it isn't silent) and recover.
        try runtime.evaluate(#"""
        globalThis.__pushNativeEvent = (name) => {
          if (name === "boom") {
            queueMicrotask(() => { throw new Error("microtask boom"); });
          } else {
            globalThis.__ran = name;
          }
          return true;
        };
        """#)

        runtime.pushNativeEvent("boom")
        runtime.pushNativeEvent("after")

        XCTAssertTrue(
            errors.contains { $0.contains("microtask boom") },
            "the throwing microtask must be routed to onError, not swallowed")
        XCTAssertEqual(
            runtime.evaluateString("globalThis.__ran"), "after",
            "the call after a throwing microtask must run on a clean slot")
    }
}
