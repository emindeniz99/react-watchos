import Foundation
import ReactWatchCore
import ReactWatchSupport
import XCTest

/// Decodes real serializer output (Fixtures/*.json, produced by the JS
/// contract-fixture test) with the codegen'd ReactWatchCore models and asserts
/// the JS<->Swift wire contract — in actual Swift, on Linux, via `swift test`.
final class WireContractTests: XCTestCase {
    private func fixture(_ name: String) throws -> Data {
        let url = try XCTUnwrap(
            Bundle.module.url(
                forResource: name, withExtension: "json", subdirectory: "Fixtures"
            ),
            "missing fixture \(name).json"
        )
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
        XCTAssertEqual(crown.double("min"), 0)
        XCTAssertEqual(crown.double("max"), 10)
        XCTAssertEqual(crown.double("value"), 5)
    }

    // M15: the FULL-surface contract — every component the wire knows, plus
    // the shared modifier props, in one serializer-generated fixture (the JS
    // side asserts completeness against the codegen schema, so a new
    // component can't skip this gate). Decode + spot-parse here binds the
    // surfaces where JS and Swift actually meet, not hand-built literals.
    func testKitchenSinkDecodesAndSpotParses() throws {
        let tree = try JSONDecoder().decode(
            RNTree.self, from: fixture("kitchen-sink"))
        XCTAssertEqual(tree.v, RNWire.version)
        let root = try XCTUnwrap(tree.root)

        // Every wire component is present and decoded (keep in lockstep with
        // codegen/schema.ts — the JS fixture test enforces the same list).
        var seen = Set<String>()
        func walk(_ node: RNNode) {
            seen.insert(node.type)
            node.children.forEach(walk)
        }
        walk(root)
        let expected: Set<String> = [
            "VStack", "HStack", "ZStack", "ScrollView", "List", "TabView",
            "Spacer", "Divider", "Text", "TimerText", "Image", "Map", "Gauge",
            "ProgressView", "Button", "Toggle", "Slider", "Stepper", "Picker",
            "DatePicker", "TextField", "SecureField", "CrownRotation",
            "NavigationStack",
            "NavigationLink", "NavigationRoute", "Alert", "AlertAction",
            "ConfirmationDialog", "Sheet", "Section", "Label", "Grid",
            "GridRow", "ShareLink", "Chart", "LabeledContent",
            "ContentUnavailable", "Toolbar", "ToolbarItem",
        ]
        XCTAssertEqual(
            expected.subtracting(seen), [],
            "components missing from the kitchen-sink fixture")

        // Shared modifier props on the root — parsed by the SAME RNStyle the
        // interpreters use, against real serializer output.
        XCTAssertEqual(root.type, "VStack")
        let insets = try XCTUnwrap(RNStyle.padding(from: root.props["padding"]))
        XCTAssertEqual(insets.horizontal, 8)
        XCTAssertEqual(insets.vertical, 2)
        let frame = try XCTUnwrap(RNStyle.frame(from: root.props["frame"]))
        XCTAssertTrue(frame.maxWidthInfinity)
        XCTAssertEqual(frame.height, 120)
        let animation = try XCTUnwrap(
            RNStyle.animation(from: root.props["animation"]))
        XCTAssertEqual(animation, RNStyle.AnimationSpec(kind: .spring, duration: 0.3))
        XCTAssertEqual(
            RNStyle.color(root.string("background")),
            .rgba(r: 0, g: 0, b: 0, a: 128.0 / 255))
        XCTAssertEqual(root.double("opacity"), 0.9)
        XCTAssertEqual(root.string("tint"), "accentColor")
        XCTAssertEqual(root.string("accessibilityLabel"), "sink-root")
        XCTAssertEqual(root.string("accessibilityHint"), "the kitchen sink")

        // High-risk per-component props, spot-parsed end to end.
        let gauge = try XCTUnwrap(find(root, "Gauge"))
        let bounds = RNStyle.gaugeBounds(
            min: gauge.double("min"), max: gauge.double("max"),
            value: gauge.double("value"))
        XCTAssertEqual(bounds.min, 0)
        XCTAssertEqual(bounds.max, 10)
        XCTAssertEqual(bounds.value, 7)

        let chart = try XCTUnwrap(find(root, "Chart"))
        let points = RNStyle.chartPoints(from: chart.props["points"])
        XCTAssertEqual(
            points,
            [
                RNStyle.ChartPoint(label: "mon", y: 1),
                RNStyle.ChartPoint(label: "tue", y: 2.5),
            ])

        let picker = try XCTUnwrap(find(root, "Picker"))
        XCTAssertEqual(picker.stringArray("options"), ["a", "b"])
        XCTAssertEqual(picker.double("value"), 1)

        let timer = try XCTUnwrap(find(root, "TimerText"))
        XCTAssertEqual(timer.double("since"), 1000)
        XCTAssertEqual(timer.bool("milliseconds"), true)

        // Rich text: the nested <Text> segment survives as an element child.
        let richText = try XCTUnwrap(find(root, "Text"))
        XCTAssertEqual(richText.string("textStyle"), "headline")
        XCTAssertFalse(richText.children.isEmpty, "rich-text segments dropped")

        // Serialized handlers cross as `true` markers, never functions.
        let toggle = try XCTUnwrap(find(root, "Toggle"))
        XCTAssertEqual(toggle.bool("onChange"), true)
    }

    func testPublishWidgetsDecodes() throws {
        let payload = try JSONDecoder().decode(
            PublishedWidgets.self, from: fixture("widgets")
        )
        XCTAssertEqual(payload.v, 1)

        let stopwatch = try XCTUnwrap(payload.widgets["stopwatch"])
        XCTAssertEqual(stopwatch.keys.sorted(), ["accessoryCircular", "accessoryInline"])

        let circular = try XCTUnwrap(stopwatch["accessoryCircular"])
        let entry = try XCTUnwrap(circular.entries.first)
        XCTAssertEqual(entry.tree?.type, "Gauge")
        XCTAssertEqual(entry.url, "reactwatch://stopwatch")
        XCTAssertEqual(entry.relevance?.score, 50)

        let control = try XCTUnwrap(payload.controls?["sw.start"])
        XCTAssertEqual(control.label, "Start")
    }
}
