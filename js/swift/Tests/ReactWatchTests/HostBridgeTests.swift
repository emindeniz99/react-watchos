import ReactWatchCore
import ReactWatchRuntime
import XCTest

/// CX-023: every GENERATED host trampoline is exercised through a real JSRuntime
/// (real quickjs-ng + the generated C marshaling) — args in, and for the methods
/// that return a value, the value back out across the boundary. A codegen bug in
/// the arg/return marshaling can't slip past "it compiles": this is the per-method
/// guarantee. Runs on Linux/macOS via `swift test` and on the watchOS sim.
final class HostBridgeTests: XCTestCase {
    // MARK: - void, string arg(s)

    func testStringArgVoidTrampolinesReceiveTheArg() throws {
        let r = try JSRuntime()
        var commit: String?
        var log: String?
        var publish: String?
        var haptic: String?
        var cancel: String?
        var ble: String?
        var sensor: String?
        r.bridge.commit = { commit = $0 }
        r.bridge.log = { log = $0 }
        r.bridge.publishWidgets = { publish = $0 }
        r.bridge.playHaptic = { haptic = $0 }
        r.bridge.cancelNotification = { cancel = $0 }
        r.bridge.ble = { ble = $0 }
        r.bridge.sensor = { sensor = $0 }
        try r.evaluate(
            #"""
            __host.commit("C");
            __host.log("L");
            __host.publishWidgets("P");
            __host.playHaptic("H");
            __host.cancelNotification("N");
            __host.ble("B");
            __host.sensor("S");
            """#)
        XCTAssertEqual(commit, "C")
        XCTAssertEqual(log, "L")
        XCTAssertEqual(publish, "P")
        XCTAssertEqual(haptic, "H")
        XCTAssertEqual(cancel, "N")
        XCTAssertEqual(ble, "B")
        XCTAssertEqual(sensor, "S")
    }

    func testSetItemReceivesBothStrings() throws {
        let r = try JSRuntime()
        var pair: (String, String)?
        r.bridge.setItem = { pair = ($0, $1) }
        try r.evaluate(#"__host.setItem("k", "v")"#)
        XCTAssertEqual(pair?.0, "k")
        XCTAssertEqual(pair?.1, "v")
    }

    // MARK: - void, numeric arg(s) — coercion across the boundary

    func testIntArgTrampolines() throws {
        let r = try JSRuntime()
        var cleared: Int?
        var aborted: Int?
        var cancelled: Int?
        r.bridge.clearTimer = { cleared = $0 }
        r.bridge.abortFetch = { aborted = $0 }
        r.bridge.cancelGenerate = { cancelled = $0 }
        try r.evaluate(
            "__host.clearTimer(11); __host.abortFetch(22); __host.cancelGenerate(33)")
        XCTAssertEqual(cleared, 11)
        XCTAssertEqual(aborted, 22)
        XCTAssertEqual(cancelled, 33)
    }

    func testSetTimerReceivesIntAndDouble() throws {
        let r = try JSRuntime()
        var got: (Int, Double)?
        r.bridge.setTimer = { got = ($0, $1) }
        try r.evaluate("__host.setTimer(7, 250.5)")
        XCTAssertEqual(got?.0, 7)
        XCTAssertEqual(got?.1 ?? 0, 250.5, accuracy: 0.0001)
    }

    // MARK: - void, mixed (int, string...) — ORDER matters

    func testMixedArgTrampolinesPreserveOrder() throws {
        let r = try JSRuntime()
        var invoke: (Int, String, String)?
        var fetch: (Int, String)?
        var generate: (Int, String)?
        r.bridge.invoke = { invoke = ($0, $1, $2) }
        r.bridge.fetch = { fetch = ($0, $1) }
        r.bridge.generate = { generate = ($0, $1) }
        try r.evaluate(
            #"""
            __host.invoke(1, "method", "payload");
            __host.fetch(2, "req");
            __host.generate(3, "gen");
            """#)
        XCTAssertEqual(invoke?.0, 1)
        XCTAssertEqual(invoke?.1, "method")
        XCTAssertEqual(invoke?.2, "payload")
        XCTAssertEqual(fetch?.0, 2)
        XCTAssertEqual(fetch?.1, "req")
        XCTAssertEqual(generate?.0, 3)
        XCTAssertEqual(generate?.1, "gen")
    }

    // MARK: - returning methods — the VALUE must cross back to JS

    func testGetItemReturnsTheStringToJS() throws {
        let r = try JSRuntime()
        var capturedKey: String?
        r.bridge.getItem = { key in
            capturedKey = key
            return "value:\(key)"
        }
        // The returned string is what JS sees back from __host.getItem.
        XCTAssertEqual(r.evaluateString(#"__host.getItem("theKey")"#), "value:theKey")
        XCTAssertEqual(capturedKey, "theKey")
    }

    func testGetItemNilBecomesNullInJS() throws {
        let r = try JSRuntime()
        r.bridge.getItem = { _ in nil }
        // nil -> JS null (not the string "null"); String(null) proves it.
        XCTAssertEqual(r.evaluateString(#"String(__host.getItem("x") === null)"#), "true")
    }

    func testCounterGetReturnsIntToJS() throws {
        let r = try JSRuntime()
        var capturedKey: String?
        r.bridge.counterGet = { key in
            capturedKey = key
            return 42
        }
        XCTAssertEqual(r.evaluateString(#"String(__host.counterGet("g"))"#), "42")
        XCTAssertEqual(capturedKey, "g")
    }

    func testCounterAddReceivesAllArgsAndReturnsInt() throws {
        let r = try JSRuntime()
        var got: (String, Int, Int, Int)?
        r.bridge.counterAdd = { key, delta, lo, hi in
            got = (key, delta, lo, hi)
            return 99
        }
        XCTAssertEqual(
            r.evaluateString(#"String(__host.counterAdd("c", 3, 0, 8))"#), "99")
        XCTAssertEqual(got?.0, "c")
        XCTAssertEqual(got?.1, 3)
        XCTAssertEqual(got?.2, 0)
        XCTAssertEqual(got?.3, 8)
    }

    func testStateRevisionTakesNoArgsAndReturnsIntToJS() throws {
        // ARCH-06's revision read is the first ZERO-arg direct host method, so
        // it exercises a trampoline shape nothing else did: no argv marshalling
        // at all, just the return. JS calling it with a stray argument must
        // still work (QuickJS passes extra args; the trampoline ignores them).
        let r = try JSRuntime()
        var calls = 0
        r.bridge.stateRevision = {
            calls += 1
            return 7
        }
        XCTAssertEqual(r.evaluateString("String(__host.stateRevision())"), "7")
        XCTAssertEqual(r.evaluateString("String(__host.stateRevision(1, 2))"), "7")
        XCTAssertEqual(calls, 2)
    }

    func testUnsetStateRevisionReadsZeroInJS() throws {
        // An embedding that doesn't back the revision (no App Group) must read
        // as 0, not throw — the JS side stamps 0 and the consumer's comparison
        // still works, it just can't prove anything.
        let r = try JSRuntime()
        XCTAssertEqual(r.evaluateString("String(__host.stateRevision())"), "0")
    }

    // MARK: - install completeness

    func testEveryDirectMethodIsInstalledOnHost() throws {
        let r = try JSRuntime()
        // The generated install table must put a function at each name.
        for name in [
            "commit", "log", "setTimer", "clearTimer", "invoke", "publishWidgets",
            "getItem", "setItem", "counterGet", "counterAdd", "stateRevision",
            "playHaptic", "cancelNotification", "fetch", "abortFetch", "ble",
            "sensor", "generate", "cancelGenerate",
        ] {
            XCTAssertTrue(
                r.evaluateBool("typeof __host.\(name) === 'function'"),
                "__host.\(name) is not installed")
        }
        // A via-invoke method is NOT a direct host function (routed through invoke).
        XCTAssertTrue(r.evaluateBool("typeof __host.saveUpdate === 'undefined'"))
    }

    func testWidgetTargetInstallsOnlyTheFunctionsItBacks() throws {
        // The widget extension can't back fetch/ble/sensor/etc., so installing
        // them as nil-backed no-op trampolines would make JS feature detection
        // (typeof __host.fetch) wrongly report them present — and a call would
        // hang on a no-op instead of failing loudly. The widget target omits them.
        let widget = try JSRuntime(target: .widget)
        // Private owning queue, released from the test thread: shut it down
        // explicitly (ARCH-08), like every production owner of one.
        defer { widget.shutdown() }
        for name in [
            "commit", "log", "setTimer", "clearTimer", "invoke", "publishWidgets",
            "getItem", "setItem", "counterGet", "counterAdd", "stateRevision",
        ] {
            XCTAssertTrue(
                widget.evaluateBool("typeof __host.\(name) === 'function'"),
                "shared __host.\(name) should be installed on the widget")
        }
        for name in [
            "playHaptic", "cancelNotification", "fetch", "abortFetch", "ble",
            "sensor", "generate", "cancelGenerate",
        ] {
            XCTAssertTrue(
                widget.evaluateBool("typeof __host.\(name) === 'undefined'"),
                "watch-only __host.\(name) must NOT be installed on the widget")
        }
    }

    // MARK: - ARCH-07 host-policy install filtering

    func testAllowedFeaturesFiltersNonCoreInstalls() throws {
        // A restricted runtime installs only the allowed features' functions;
        // JS feature detection (typeof) must reflect the policy, not the binary.
        let r = try JSRuntime(allowedFeatures: ["core", "storage"])
        for name in [
            "getItem", "setItem", "counterGet", "counterAdd", "stateRevision",
        ] {
            XCTAssertTrue(
                r.evaluateBool("typeof __host.\(name) === 'function'"),
                "allowed __host.\(name) should be installed")
        }
        for name in [
            "fetch", "abortFetch", "ble", "sensor", "generate", "cancelGenerate",
            "publishWidgets",
        ] {
            XCTAssertTrue(
                r.evaluateBool("typeof __host.\(name) === 'undefined'"),
                "policy-blocked __host.\(name) must NOT be installed")
        }
        // "core" is installed even without appearing in the allowlist…
        let coreOnly = try JSRuntime(allowedFeatures: [])
        for name in ["commit", "log", "setTimer", "clearTimer", "invoke"] {
            XCTAssertTrue(
                coreOnly.evaluateBool("typeof __host.\(name) === 'function'"),
                "core __host.\(name) must survive any policy")
        }
        // …and everything else is gone under the empty allowlist.
        XCTAssertTrue(coreOnly.evaluateBool("typeof __host.getItem === 'undefined'"))
    }

    func testNilAllowedFeaturesInstallsEverythingForTheTarget() throws {
        // nil = unrestricted (the default): identical to the pre-policy bridge.
        let r = try JSRuntime(allowedFeatures: nil)
        for name in ["commit", "getItem", "publishWidgets", "fetch", "generate"] {
            XCTAssertTrue(
                r.evaluateBool("typeof __host.\(name) === 'function'"),
                "unrestricted __host.\(name) should be installed")
        }
    }

    func testWidgetTargetAppliesAllowedFeaturesOnTopOfItsSubset() throws {
        // Policy composes with target filtering: the widget's watch-only
        // omissions still hold, and the allowlist gates the rest.
        let widget = try JSRuntime(target: .widget, allowedFeatures: ["widgets"])
        defer { widget.shutdown() }
        XCTAssertTrue(widget.evaluateBool("typeof __host.publishWidgets === 'function'"))
        XCTAssertTrue(widget.evaluateBool("typeof __host.commit === 'function'"))
        XCTAssertTrue(widget.evaluateBool("typeof __host.getItem === 'undefined'"))
        XCTAssertTrue(widget.evaluateBool("typeof __host.fetch === 'undefined'"))
        // …but NOT stateRevision, which is "core" precisely so it cannot be
        // gated asymmetrically: a payload this extension renders must always be
        // able to stamp the revision the NATIVE freshness gate compares it
        // against (ReactTimeline builds its own counter store, which no policy
        // can remove). Falling back to `?? 0` here stamps 0 over the app's
        // rev-N payload and makes every later timeline request read
        // `.staleRevision` — a full QuickJS boot per request, forever.
        XCTAssertTrue(
            widget.evaluateBool("typeof __host.stateRevision === 'function'"),
            "stateRevision must survive any policy — it is the payload's provenance")
    }
}
