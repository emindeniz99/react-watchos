import Foundation
import ReactWatchCore
import ReactWatchRuntime
import ReactWatchSupport
import XCTest

/// Boots the REAL production bundle — `js/dist/bundle.js`, and the `.qbc`
/// bytecode next to it — inside the REAL embedding (`JSRuntime`).
///
/// The gap this closes: `RuntimeSmokeTests` drives JSRuntime with hand-written
/// snippets, and `tools/embed-smoke` runs the shipped bundle but through a C
/// host on Linux only. Nothing ever ran the shipped artifact through the Swift
/// class the watch actually uses — so "the real bundle boots in the real
/// embedding on the real OS" was proven for the C reference host, not for the
/// thing we ship. Under `xcodebuild test` this file runs on the watchOS
/// simulator, which is the point; `swift test` runs the same contract on Linux.
///
/// The assertions deliberately mirror `tools/embed-smoke/embed-host.c`'s
/// epilogue rather than a weaker "it didn't throw": a committed
/// NavigationStack, ARCH-09 lazy mounting at launch, an accepted navigation
/// transaction, and a press that advances the counter.
final class BundleSmokeTests: XCTestCase {
    // MARK: - Locating the build product

    /// `js/dist`, resolved from THIS file's compile-time path:
    /// `js/swift/Tests/ReactWatchTests/BundleSmokeTests.swift` — four
    /// `deletingLastPathComponent`s land on `js/`.
    ///
    /// Not a `Bundle.module` resource on purpose: the bundle is a build
    /// product (gitignored, produced by `pnpm --filter react-watchos build`),
    /// and copying a 600 KB artifact into the test bundle would mean SwiftPM
    /// caching a stale copy of the very thing under test.
    private static let distURL: URL =
        URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()  // ReactWatchTests
        .deletingLastPathComponent()  // Tests
        .deletingLastPathComponent()  // swift
        .deletingLastPathComponent()  // js
        .appendingPathComponent("dist")

    /// A missing build product under `REQUIRE_BUNDLE=1`. Thrown (rather than
    /// skipped) so the test FAILS — see `locate`.
    private struct BundleMissing: Error, CustomStringConvertible {
        let description: String
    }

    /// The build product at `js/dist/<name>`, or a skip explaining how to make
    /// it exist.
    ///
    /// `REQUIRE_BUNDLE=1` turns that skip into a loud failure — the same
    /// posture `REQUIRE_QJS` gives the engine gate in `js/test/qjs-smoke.test.ts`.
    /// CI builds the bundle before the simulator run, so a skip THERE would mean
    /// this gate silently stopped running, which is the failure mode that makes
    /// a smoke test decorative.
    private static func locate(_ name: String, buildWith command: String) throws -> URL {
        let url = distURL.appendingPathComponent(name)
        if FileManager.default.fileExists(atPath: url.path) { return url }
        let message = """
            js/dist/\(name) does not exist, so the production bundle was never \
            booted. It is a BUILD PRODUCT, not a fixture — run `\(command)` \
            from the repo root before `swift test` / `xcodebuild test`. \
            Looked at: \(url.path)
            """
        if ProcessInfo.processInfo.environment["REQUIRE_BUNDLE"] == "1" {
            throw BundleMissing(description: message)
        }
        throw XCTSkip(message)
    }

    // MARK: - Tests

    /// The source path: what a dev build and an OTA bundle load.
    func testProductionBundleSourceBoots() throws {
        let url = try Self.locate("bundle.js", buildWith: "pnpm --filter react-watchos build")
        let source = try String(contentsOf: url, encoding: .utf8)
        try assertBootContract(loading: "bundle.js") { runtime in
            try runtime.evaluate(source, filename: "bundle.js")
        }
    }

    /// The bytecode path: what SHIPS. `ReactWatchHost.loadShipped` prefers
    /// `bundle.qbc` and only falls back to the source, so this — not the test
    /// above — is the production boot sequence on the watch.
    func testProductionBundleBytecodeBoots() throws {
        let url = try Self.locate(
            "bundle.qbc", buildWith: "pnpm --filter react-watchos build:bytecode")
        let bytecode = try Data(contentsOf: url)
        try assertBootContract(loading: "bundle.qbc") { runtime in
            try runtime.evaluateBytecode(bytecode)
        }
    }

    // MARK: - The boot contract

    /// Loads the bundle through `load` and asserts the same contract for both
    /// artifacts — so a `.qbc` that reads but renders something else fails here
    /// rather than on a wrist.
    private func assertBootContract(
        loading what: String, _ load: (JSRuntime) throws -> Void
    ) throws {
        // A private queue (not main) so `shutdown()` releases the engine
        // deterministically at the end of the test — the ARCH-08 shape every
        // non-app owner uses.
        let runtime = try JSRuntime(queue: DispatchQueue(label: "test.bundle-smoke"))
        defer { runtime.shutdown() }
        let host = BootHost()
        host.install(on: runtime)
        var errors: [String] = []
        runtime.onError = { errors.append("\($0): \($1)") }

        try load(runtime)

        XCTAssertEqual(errors, [], "\(what) reported JS errors while booting")

        // 1. A real tree was committed DURING eval — no waiting, no timers.
        let launch = try latestTree(host, what: what)
        let root = try XCTUnwrap(launch.root, "\(what): the launch commit carried no root")
        XCTAssertEqual(launch.v, RNWire.version, "\(what): wire version")
        XCTAssertEqual(root.type, "NavigationStack", "\(what): root node type")
        // A root-only tree is exactly what a mount that threw looks like, and
        // the C harness's own epilogue can only work on children (it searches
        // for Text/Button nodes), so "> 0" is asserted as "the root has a
        // rendered app under it", not as the tautology `count(root) >= 1`.
        XCTAssertGreaterThan(
            nodeCount(root), 1, "\(what): the committed tree is just a bare root")

        // 2. Boot reached MORE of the host surface than `commit`: the demo
        //    publishes its complication timelines at launch, which routes
        //    through publishWidgets + the ARCH-05 counters. The C harness
        //    no-ops that call; here it proves the generated Swift trampolines
        //    carried it.
        XCTAssertFalse(
            host.published.isEmpty, "\(what): no widget timeline was published at boot")

        // 3. ARCH-09 lazy mounting: /counter is NOT serialized at launch.
        XCTAssertNil(
            text(startingWith: "Count: ", in: root),
            "\(what): inactive /counter was serialized at launch")

        // 4. Navigation is a confirmed transaction — the verdict comes back
        //    through the JS_Call bridge, and the SAME commit carries the
        //    newly mounted subtree.
        let nav = DispatchResult.parse(
            runtime.dispatchEventReturning(
                nodeId: root.id, event: "pathChange",
                payloadJson: #"{"path":["/counter"]}"#, seq: 1))
        XCTAssertTrue(nav.handled, "\(what): navigation not handled")
        XCTAssertTrue(
            nav.accepted, "\(what): navigation not accepted (\(nav.reason ?? "no reason"))")

        let mounted = try XCTUnwrap(
            try latestTree(host, what: what).root, "\(what): no root after navigating")
        let initialCount = try XCTUnwrap(
            text(startingWith: "Count: ", in: mounted)?.string("text"),
            "\(what): /counter did not mount inside the confirming dispatch")

        // 5. A press runs a real React handler and re-commits synchronously.
        let plus = try XCTUnwrap(
            button(labeled: "+", in: mounted), "\(what): no '+' button in the mounted tree")
        let press = DispatchResult.parse(
            runtime.dispatchEventReturning(nodeId: plus.id, event: "press"))
        XCTAssertTrue(press.handled, "\(what): press not handled")
        XCTAssertTrue(
            press.accepted, "\(what): press not accepted (\(press.reason ?? "no reason"))")

        let after = try XCTUnwrap(
            try latestTree(host, what: what).root, "\(what): no root after the press")
        let countAfterPress = try XCTUnwrap(
            text(startingWith: "Count: ", in: after)?.string("text"),
            "\(what): the counter text vanished after the press")
        XCTAssertEqual(
            countValue(countAfterPress), countValue(initialCount).map { $0 + 1 },
            "\(what): count did not advance: \(initialCount) -> \(countAfterPress)")

        XCTAssertEqual(errors, [], "\(what) reported JS errors while dispatching")
    }

    /// Decodes the most recent `__host.commit` payload with the codegen'd wire
    /// models — the same decode `ReactWatchHost` does on the watch.
    private func latestTree(_ host: BootHost, what: String) throws -> RNTree {
        let json = try XCTUnwrap(
            host.commits.last, "\(what): nothing was ever committed (js logs: \(host.logs))")
        return try JSONDecoder().decode(RNTree.self, from: Data(json.utf8))
    }
}

// MARK: - The minimal host surface

/// The smallest `__host` the production bundle needs at boot, mirroring
/// `tools/embed-smoke/embed-host.c` and `qjs-smoke.test.ts`'s harness prelude.
/// Installed BEFORE the bundle is evaluated, because the first tree is
/// committed during eval.
///
/// `JSRuntime` already installs the generated `__host` object in `init`; the
/// C trampolines dispatch into these closures, so wiring the closures IS the
/// mock — nothing here reaches into the engine.
private final class BootHost {
    private(set) var commits: [String] = []
    private(set) var published: [String] = []
    /// `console.*`. Captured rather than left on JSRuntime's default sink
    /// (`print` on Linux, os.Logger on Apple) so the bundle can't spam the test
    /// output — and so a boot that commits nothing can say what it logged.
    private(set) var logs: [String] = []
    /// Timer ids the bundle armed, recorded and never fired — the C harness
    /// does the same (`host_set_timer` pushes to `__timers`). Overriding
    /// JSRuntime's default scheduler is what keeps this test deterministic:
    /// a real `DispatchSourceTimer` would land a re-render on the owning queue
    /// at an arbitrary point between assertions. Nothing in the contract below
    /// needs a timer to fire — boot and every dispatch commit synchronously.
    private(set) var armedTimers: [Int] = []
    /// Invokes are recorded and left unsettled (the C harness does not install
    /// `invoke` at all): the demo's boot-time OTA `markUpdateHealthy` just
    /// stays pending, which is what an unanswered native op looks like anyway.
    private(set) var invokes: [(id: Int, method: String)] = []
    /// ARCH-05 atomic counters: the clamped read-modify-write
    /// `CoordinatedCounterStore` performs on the watch, in a dictionary.
    private var counters: [String: Int] = [:]

    func install(on runtime: JSRuntime) {
        runtime.bridge.commit = { [self] json in commits.append(json) }
        runtime.bridge.log = { [self] message in logs.append(message) }
        runtime.bridge.setTimer = { [self] id, _ in armedTimers.append(id) }
        runtime.bridge.clearTimer = { [self] id in
            if let index = armedTimers.firstIndex(of: id) { armedTimers.remove(at: index) }
        }
        runtime.bridge.invoke = { [self] id, method, _ in
            invokes.append((id: id, method: method))
        }
        runtime.bridge.publishWidgets = { [self] json in published.append(json) }
        runtime.bridge.counterGet = { [self] key in counters[key] ?? 0 }
        runtime.bridge.counterAdd = { [self] key, delta, min, max in
            let next = Swift.min(max, Swift.max(min, (counters[key] ?? 0) + delta))
            counters[key] = next
            return next
        }
    }
}

// MARK: - Tree helpers (the C epilogue's findAll, in Swift)

private func nodeCount(_ node: RNNode) -> Int {
    1 + node.children.reduce(0) { $0 + nodeCount($1) }
}

private func findAll(_ node: RNNode, type: String, into out: inout [RNNode]) {
    if node.type == type { out.append(node) }
    for child in node.children { findAll(child, type: type, into: &out) }
}

private func findAll(_ node: RNNode, type: String) -> [RNNode] {
    var out: [RNNode] = []
    findAll(node, type: type, into: &out)
    return out
}

private func text(startingWith prefix: String, in root: RNNode) -> RNNode? {
    findAll(root, type: "Text").first { $0.string("text")?.hasPrefix(prefix) == true }
}

private func button(labeled label: String, in root: RNNode) -> RNNode? {
    findAll(root, type: "Button").first { candidate in
        findAll(candidate, type: "Text").contains { $0.string("text") == label }
    }
}

/// `"Count: 3"` -> `3`.
private func countValue(_ text: String) -> Int? {
    Int(text.dropFirst("Count: ".count))
}
