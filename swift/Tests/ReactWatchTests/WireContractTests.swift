import Foundation
import ReactWatchCore
import XCTest

// Decodes real serializer output (Fixtures/*.json, produced by the JS
// contract-fixture test) with the codegen'd ReactWatchCore models and asserts
// the JS<->Swift wire contract — in actual Swift, on Linux, via `swift test`.
final class WireContractTests: XCTestCase {
    private func fixture(_ name: String) throws -> Data {
        let url = try XCTUnwrap(
            Bundle.module.url(
                forResource: name, withExtension: "json", subdirectory: "Fixtures"),
            "missing fixture \(name).json")
        return try Data(contentsOf: url)
    }

    private func find(_ node: RNNode, _ type: String) -> RNNode? {
        if node.type == type { return node }
        for child in node.children where true {
            if let match = find(child, type) { return match }
        }
        return nil
    }

    private func findText(_ node: RNNode, _ text: String) -> RNNode? {
        if node.type == "Text", node.string("text") == text { return node }
        for child in node.children {
            if let match = findText(child, text) { return match }
        }
        return nil
    }

    func testCommitTreeDecodes() throws {
        let tree = try JSONDecoder().decode(RNTree.self, from: fixture("tree"))
        XCTAssertEqual(tree.v, RNWire.version)
        let root = try XCTUnwrap(tree.root)
        XCTAssertEqual(root.type, "VStack")

        let timer = try XCTUnwrap(find(root, "TimerText"))
        XCTAssertEqual(timer.double("since"), 1000)

        let toggle = try XCTUnwrap(find(root, "Toggle"))
        XCTAssertEqual(toggle.bool("value"), true)

        XCTAssertNotNil(findText(root, "Connected"), "Text didn't fold to props.text")

        let crown = try XCTUnwrap(find(root, "CrownRotation"))
        XCTAssertEqual(crown.double("from"), 0)
        XCTAssertEqual(crown.double("through"), 10)
        XCTAssertEqual(crown.double("value"), 5)
    }

    func testPublishWidgetsDecodes() throws {
        let payload = try JSONDecoder().decode(
            PublishedWidgets.self, from: fixture("widgets"))
        XCTAssertEqual(payload.v, 1)

        let stopwatch = try XCTUnwrap(payload.widgets["stopwatch"])
        XCTAssertEqual(stopwatch.keys.sorted(), ["accessoryCircular", "accessoryInline"])

        let circular = try XCTUnwrap(stopwatch["accessoryCircular"])
        let entry = try XCTUnwrap(circular.entries.first)
        XCTAssertEqual(entry.tree?.type, "Gauge")
        XCTAssertEqual(entry.relevance?.score, 50)

        let control = try XCTUnwrap(payload.controls?["sw.start"])
        XCTAssertEqual(control.label, "Start")
    }
}
