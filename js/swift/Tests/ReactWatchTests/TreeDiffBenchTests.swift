import Foundation
import XCTest

@testable import ReactWatchCore

/// Tree-diff prototype, Swift half (docs/perf-tree-diff.md).
///
/// The `treediff-*` fixtures are real demo-app commit payloads captured by
/// js/test/treediff-workloads.test.tsx (small = the counter screen, large =
/// the ~600-node shopping-list stack) plus the patch the JS prototype
/// (tools/embed-smoke/treediff-proto.js) computed between them. This file:
///
///  1. pins the CROSS-LANGUAGE contract: applying the JS-produced patch over
///     decoded `RNNode` values must reproduce the after-tree exactly — the
///     same fixture discipline ARCH-11 uses for the invoke wire;
///  2. MEASURES the native side of the tree-diff question on Linux CI-class
///     hardware: full-tree `JSONDecoder` cost, the NF-22 `root != tree.root`
///     equality guard (independent-decode vs shared-storage vs short-circuit
///     unequal), and patch decode+apply with structural sharing.
///
/// The timings are printed, never asserted — they feed the report, and a
/// timing threshold on shared CI hardware would only flake (see the variance
/// note in docs/performance-measurement.md §3). What IS asserted is
/// correctness: decode succeeds, the patch round-trips, unequal trees
/// compare unequal. The patch APPLY here is measurement code — nothing in
/// the shipping targets consumes patches (the wire stays full-tree, one
/// shape; that is the report's verdict).
final class TreeDiffBenchTests: XCTestCase {
    private struct TreePatch: Codable {
        struct Entry: Codable {
            let id: Int
            let type: String
            let props: [String: JSONValue]
            let children: [Int]
        }
        let v: Int
        let seq: Int
        let root: Int?
        let upsert: [Entry]
        let removed: [Int]
    }

    private func fixture(_ name: String) throws -> Data {
        let url = try XCTUnwrap(
            Bundle.module.url(
                forResource: name, withExtension: "json", subdirectory: "Fixtures"
            ),
            "missing fixture \(name).json — run `pnpm --filter react-watchos test` to regenerate"
        )
        return try Data(contentsOf: url)
    }

    /// The prototype apply: persistent path-copy over the old value tree.
    /// Nodes reachable only through unchanged paths are REUSED whole (their
    /// storage is shared with the old tree — the structural-sharing half of
    /// the measurement); upserted nodes and their ancestors are rebuilt.
    private func apply(_ patch: TreePatch, to oldRoot: RNNode?) throws -> RNNode? {
        var index: [Int: RNNode] = [:]
        var parents: [Int: Int] = [:]
        func walk(_ node: RNNode) {
            index[node.id] = node
            for child in node.children {
                parents[child.id] = node.id
                walk(child)
            }
        }
        if let oldRoot { walk(oldRoot) }
        var upsertMap: [Int: TreePatch.Entry] = [:]
        for entry in patch.upsert { upsertMap[entry.id] = entry }
        // Transitively dirty: every upserted id plus its old-tree ancestors
        // (a new node's parent carries a changed child list, so the parent is
        // itself upserted and seeds its own chain).
        var dirty = Set<Int>()
        for entry in patch.upsert {
            dirty.insert(entry.id)
            var parent = parents[entry.id]
            while let current = parent, !dirty.contains(current) {
                dirty.insert(current)
                parent = parents[current]
            }
        }
        struct StaleBase: Error { let id: Int }
        func build(_ id: Int) throws -> RNNode {
            if let entry = upsertMap[id] {
                return RNNode(
                    id: entry.id, type: entry.type, props: entry.props,
                    children: try entry.children.map(build))
            }
            guard let old = index[id] else { throw StaleBase(id: id) }
            if !dirty.contains(id) { return old }
            return RNNode(
                id: old.id, type: old.type, props: old.props,
                children: try old.children.map { try build($0.id) })
        }
        guard let rootId = patch.root else { return nil }
        return try build(rootId)
    }

    private func ms(_ duration: Duration) -> Double {
        Double(duration.components.seconds) * 1000.0
            + Double(duration.components.attoseconds) / 1e15
    }

    // MARK: - Alternative decoder (measurement only)

    /// `RNTree` decode via `JSONSerialization` + a hand-rolled builder,
    /// timed against `JSONDecoder`. Codable's `JSONValue.init(from:)` is a
    /// try?-cascade over a single-value container — one thrown-and-dropped
    /// `DecodingError` per non-bool prop value — and the measurement below
    /// shows THAT, not the wire shape, is where the native commit path's
    /// time goes. Kept in the test because it is an argument, not a product:
    /// if cost #2 ever needs cutting, swap the decoder before touching the
    /// wire (docs/perf-tree-diff.md).
    private func jsonValue(_ any: Any) -> JSONValue {
        if let string = any as? String { return .string(string) }
        #if canImport(Darwin)
        // On Darwin every scalar is an NSNumber and `as? Bool` would
        // happily turn 1 into true — CFBoolean is the only honest test.
        if let number = any as? NSNumber {
            if CFGetTypeID(number) == CFBooleanGetTypeID() {
                return .bool(number.boolValue)
            }
            return .number(number.doubleValue)
        }
        #else
        // swift-corelibs-foundation hands back native Bool/Int/Double.
        if let bool = any as? Bool { return .bool(bool) }
        if let int = any as? Int { return .number(Double(int)) }
        if let double = any as? Double { return .number(double) }
        #endif
        if let array = any as? [Any] { return .array(array.map(jsonValue)) }
        if let object = any as? [String: Any] {
            return .object(object.mapValues(jsonValue))
        }
        return .null
    }

    private func node(fromAny any: Any) -> RNNode? {
        guard let dict = any as? [String: Any],
            let id = dict["id"] as? Int,
            let type = dict["type"] as? String
        else { return nil }
        let props = (dict["props"] as? [String: Any]) ?? [:]
        let children = (dict["children"] as? [Any]) ?? []
        return RNNode(
            id: id, type: type,
            props: props.mapValues(jsonValue),
            children: children.compactMap { node(fromAny: $0) })
    }

    private func serializationDecode(_ data: Data) throws -> RNNode? {
        let raw = try JSONSerialization.jsonObject(with: data)
        guard let dict = raw as? [String: Any], let root = dict["root"] else {
            return nil
        }
        return node(fromAny: root)
    }

    func testPatchAppliedInSwiftReproducesTheAfterTree() throws {
        let decoder = JSONDecoder()
        for scale in ["small", "large"] {
            let before = try decoder.decode(RNTree.self, from: fixture("treediff-\(scale)-before"))
            let after = try decoder.decode(RNTree.self, from: fixture("treediff-\(scale)-after"))
            let patch = try decoder.decode(TreePatch.self, from: fixture("treediff-\(scale)-patch"))
            XCTAssertEqual(before.v, RNWire.version)
            XCTAssertEqual(patch.v, RNWire.version)
            XCTAssertEqual(patch.seq, after.seq, "patch carries the after-commit's seq ack")
            let applied = try apply(patch, to: before.root)
            XCTAssertEqual(
                applied, after.root,
                "JS-diffed patch applied over decoded RNNodes must reproduce the after tree (\(scale))"
            )
            XCTAssertNotEqual(before.root, after.root)
        }
    }

    func testDecodeEqualityAndApplyTimings() throws {
        let decoder = JSONDecoder()
        let beforeData = try fixture("treediff-large-before")
        let afterData = try fixture("treediff-large-after")
        let patchData = try fixture("treediff-large-patch")
        let before = try decoder.decode(RNTree.self, from: beforeData)
        let after = try decoder.decode(RNTree.self, from: afterData)
        let afterAgain = try decoder.decode(RNTree.self, from: afterData)
        let patch = try decoder.decode(TreePatch.self, from: patchData)
        let applied = try apply(patch, to: before.root)
        XCTAssertEqual(applied, after.root)

        let clock = ContinuousClock()
        func measure(_ iterations: Int, _ body: () throws -> Void) rethrows -> Double {
            let elapsed = try clock.measure {
                for _ in 0..<iterations { try body() }
            }
            return ms(elapsed) / Double(iterations)
        }

        // Today's per-commit native path: full decode off-main…
        var kept = false
        let decodeMs = try measure(40) {
            kept = try decoder.decode(RNTree.self, from: afterData).root != nil
        }
        // …the same payload through JSONSerialization + a hand-built tree —
        // isolates Codable's try?-cascade overhead from the bytes themselves
        // (correctness pinned first: both decoders must agree exactly).
        XCTAssertEqual(try serializationDecode(afterData), after.root)
        let decodeSerializationMs = try measure(40) {
            kept = try serializationDecode(afterData) != nil
        }
        // Small (demo-realistic ~50-node) commit for scaling context.
        let smallData = try fixture("treediff-small-after")
        let decodeSmallMs = try measure(200) {
            kept = try decoder.decode(RNTree.self, from: smallData).root != nil
        }
        // …then the NF-22 equality guard on main. Three shapes of it:
        // two independent decodes (all-fresh storage — today's equal case),
        let eqIndependentMs = measure(40) { kept = after.root == afterAgain.root }
        // the same decode compared to a copy of itself (shared storage),
        let afterCopy = after
        let eqSharedMs = measure(40) { kept = after.root == afterCopy.root }
        // and a real change (short-circuits at the first differing node).
        let eqUnequalMs = measure(40) { kept = before.root == after.root }
        // The candidate path: decode the patch, path-copy apply it.
        let patchDecodeApplyMs = try measure(40) {
            let p = try decoder.decode(TreePatch.self, from: patchData)
            kept = try apply(p, to: before.root) != nil
        }
        // Equality guard when the new tree came from a patch apply: unchanged
        // subtrees share storage with the base, so == can fast-path them.
        let eqAppliedMs = measure(40) { kept = applied == after.root }
        XCTAssertTrue(kept)

        let fmt = { (value: Double) in String(format: "%.3f", value) }
        print(
            """
            [treediff-bench] large fixture: \(afterData.count) bytes on the wire, \
            small: \(smallData.count)
            [treediff-bench] decodeFullMs=\(fmt(decodeMs)) \
            decodeSerializationMs=\(fmt(decodeSerializationMs)) \
            decodeSmallMs=\(fmt(decodeSmallMs)) \
            eqIndependentDecodesMs=\(fmt(eqIndependentMs)) \
            eqSharedStorageMs=\(fmt(eqSharedMs)) \
            eqUnequalMs=\(fmt(eqUnequalMs)) \
            patchDecodeApplyMs=\(fmt(patchDecodeApplyMs)) \
            eqAppliedVsDecodedMs=\(fmt(eqAppliedMs))
            """)
    }
}
