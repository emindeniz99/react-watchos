// NodeView is watchOS-only (#if os(watchOS) in ReactWatchHost); this test
// compiles to nothing under `swift test` on macOS/Linux and runs only on the
// watchOS simulator via `xcodebuild test`.
#if os(watchOS)
import ReactWatchCore
import SwiftUI
import UIKit
import XCTest

@testable import ReactWatchHost

/// The first behavioural test of NodeView, pinning one property: rendering a
/// wire tree never traps, whatever its props hold. A JS bundle — including a
/// signed OTA bundle from a compromised origin — can put any JSON in any prop,
/// and the interpreter runs it inside the host app AND (via the shared
/// RNStyle/RNUI kernels) the widget extension. A prop that force-unwraps,
/// indexes, builds a `ClosedRange`, or converts a huge Double to Int is a
/// remote crash. The documented contract for bad input is `unsupportedNode`:
/// render what you can, log once, keep the siblings, never trap.
///
/// Rendering goes through `ImageRenderer`, not a hosting controller: watchOS
/// has no `UIHostingController`, and the parsing this test cares about lives
/// in `body` evaluation, which ImageRenderer drives all the way down. Its
/// documented limit is the other half: it does not RENDER UIKit-backed views
/// (List, TextField, Map, pickers, wheels), so `uiImage` is legitimately nil
/// for those and for empty content. "Rendering completed" is therefore the
/// assertion; `XCTAssertNotNil(uiImage)` is asserted only where the content is
/// native SwiftUI (text and stacks of text).
///
/// Part 1 renders every RNTree fixture whole, then every kitchen-sink node AS
/// ITS OWN ROOT. The second pass exists because a whole-tree render evaluates
/// only what is on screen: a primitive that appears solely inside a Sheet, a
/// pushed NavigationRoute, or a lazy List row never has its `body` run. The
/// set of types rendered that way must equal the `case` labels in
/// `NodeView.rendered`, so adding a primitive without extending the fixture
/// fails here.
///
/// Part 2 is a table of hostile-but-wire-reachable props, one row per line of
/// NodeView (or RNUI/RNStyle) that could trap on it. Every row is built as
/// JSON text and decoded with `RNTree(wireJSON:)` — the production decoder —
/// so each case is reachable from the wire by construction (JSON cannot carry
/// NaN or ±inf, `1e400` is refused by the decoder and `±1e308` comes back as
/// that finite Double; both pinned in WireDecodeTests, so there are no
/// non-finite rows). A trap aborts the test process, so each row writes its
/// name to stderr first: the CI log then names the culprit instead of
/// stopping at the test method. stderr, not `print`: under xcodebuild the
/// process's stdout is a pipe, block-buffered, and a SIGTRAP does not flush
/// it, so the lines just before an abort would be the ones lost.
///
/// The table and corpus renders are wrapped in a watch-sized frame and
/// clipped: rows that make the view ~1e308 pt (fixed frames, padding, font
/// sizes) would otherwise hand ImageRenderer a bitmap of that size, and an
/// abort inside its rasterizer would be misread as an interpreter trap. The
/// inner body and layout still evaluate; only the bitmap is bounded. The
/// two tests that measure the image render unbounded.
@MainActor
final class NodeViewRenderTests: XCTestCase {
    /// The `case "..."` labels of `NodeView.rendered`, hard-coded so the
    /// per-node walk fails when a primitive lands without a fixture node.
    /// WireContractTests already pins kitchen-sink against
    /// js/src/components.ts; this pins it against the interpreter's switch.
    private static let renderedCases: Set<String> = [
        "VStack", "HStack", "Text", "TimerText", "FormattedText", "Button",
        "Toggle", "Spacer", "Image", "ZStack", "ScrollView", "List", "Divider",
        "Gauge", "ProgressView", "NavigationStack", "NavigationLink",
        "NavigationRoute", "Alert", "ConfirmationDialog", "AlertAction", "Sheet",
        "Section", "Label", "Grid", "GridRow", "ShareLink", "Chart",
        "LabeledContent", "ContentUnavailable", "Toolbar", "ToolbarItem",
        "TextField", "SecureField", "Picker", "TabView", "CrownRotation",
        "Slider", "Stepper", "DatePicker", "Map",
    ]

    /// Inert: init builds the stores and the OTA sequencer, only `start()`
    /// boots the JS runtime. Body evaluation reads its optimistic stores only.
    private lazy var model = ReactWatchModel(appGroupId: nil)

    // MARK: - Part 1: corpus

    func testEveryTreeFixtureRendersWhole() throws {
        for name in [
            "tree", "kitchen-sink", "treediff-small-before", "treediff-small-after",
            "treediff-large-before", "treediff-large-after",
        ] {
            let tree = try RNTree(wireJSON: Self.fixture(name))
            let root = try XCTUnwrap(tree.root, "\(name).json has no root")
            mark("fixture \(name)")
            render(root)
        }
    }

    func testEveryKitchenSinkNodeRendersAsRoot() throws {
        let tree = try RNTree(wireJSON: Self.fixture("kitchen-sink"))
        let root = try XCTUnwrap(tree.root)
        var rendered = Set<String>()
        func walk(_ node: RNNode) {
            mark("kitchen-sink root \(node.type)#\(node.id)")
            render(node)
            rendered.insert(node.type)
            node.children.forEach(walk)
        }
        walk(root)
        XCTAssertEqual(
            rendered.symmetricDifference(Self.renderedCases), [],
            "kitchen-sink.json and NodeView.rendered disagree on the primitive set")
    }

    /// The positive control for every "completes" assertion above: native
    /// SwiftUI content does come back as pixels from this harness, so a nil
    /// image elsewhere means UIKit-backed content, not a broken renderer.
    func testNativeTextProducesAnImage() throws {
        let node = try Self.decode(
            Self.n(
                "VStack", #"{"spacing":2}"#,
                [
                    Self.n("Text", id: 2, #"{"text":"alpha","bold":true}"#),
                    Self.n("Text", id: 3, ##"{"text":"beta","color":"#FF8000"}"##),
                ]))
        let image = try XCTUnwrap(render(node, bounded: false))
        XCTAssertGreaterThan(image.size.height, 0)
    }

    // MARK: - Part 2: adversarial props

    /// The documented contract of `unsupportedNode`: an unknown type in the
    /// middle of a VStack is skipped and its siblings still render. Fixed
    /// heights and zero spacing make the check exact: the stack with the
    /// stranger is as tall as the stack without it, so both siblings laid out
    /// and the stranger contributed nothing.
    func testUnknownNodeTypeInsideVStackRendersSiblings() throws {
        let text = { (id: Int, label: String) in
            Self.n("Text", id: id, #"{"text":"\#(label)","frame":{"height":40}}"#)
        }
        let control = try Self.decode(
            Self.n("VStack", #"{"spacing":0}"#, [text(2, "A"), text(3, "B")]))
        let withStranger = try Self.decode(
            Self.n(
                "VStack", #"{"spacing":0}"#,
                [text(2, "A"), Self.n("HoloDeck", id: 4, #"{"text":"?"}"#), text(3, "B")]))
        let expected = try XCTUnwrap(render(control, bounded: false))
        let actual = try XCTUnwrap(render(withStranger, bounded: false))
        XCTAssertEqual(actual.size.height, expected.size.height, accuracy: 0.5)
        XCTAssertEqual(actual.size.height, 80, accuracy: 0.5, "two 40pt rows expected")
    }

    /// 200 nested VStacks: JSON depth ~400 (under the decoder's 512 cap) and a
    /// 200-deep recursive `childViews` → `NodeView` → `LayoutModifier` chain.
    /// Pins the recursion, on the simulator's main-thread stack.
    func testDeepNestingRenders() throws {
        var json = Self.n("Text", id: 201, #"{"text":"leaf"}"#)
        for id in stride(from: 200, through: 1, by: -1) {
            json = Self.n("VStack", id: id, #"{"spacing":0}"#, [json])
        }
        let node = try Self.decode(json)
        XCTAssertNotNil(render(node))

        // Same depth through the rich-text fold (RNUI.textSegment recurses).
        var rich = Self.n("Text", id: 201, #"{"text":"leaf"}"#)
        for id in stride(from: 200, through: 1, by: -1) {
            rich = Self.n("Text", id: id, #"{"text":""}"#, [rich])
        }
        XCTAssertNotNil(render(try Self.decode(rich)))
    }

    func testHostilePropsDegradeWithoutTrapping() throws {
        for (_, cases) in Self.hostile {
            for c in cases {
                let node: RNNode
                do {
                    node = try Self.decode(c.json)
                } catch {
                    XCTFail(
                        "\(c.type) \(c.prop)=\(c.value): case JSON is not wire-decodable: \(error)")
                    continue
                }
                mark("\(c.type) \(c.prop)=\(c.value) — \(c.why)")
                render(node)
            }
        }
    }

    // MARK: - Harness

    /// The one render path: NodeView + the inert model in the environment,
    /// through ImageRenderer at a 41mm-ish proposal so layout actually runs.
    /// `bounded` fixes the bitmap to that size (see the type comment); the
    /// measuring tests pass false.
    @discardableResult
    private func render(_ node: RNNode, bounded: Bool = true) -> UIImage? {
        let content = NodeView(node: node).environment(model)
        let renderer: ImageRenderer<AnyView>
        if bounded {
            renderer = ImageRenderer(
                content: AnyView(content.frame(width: 198, height: 242).clipped()))
        } else {
            renderer = ImageRenderer(content: AnyView(content))
        }
        renderer.proposedSize = ProposedViewSize(width: 198, height: 242)
        return renderer.uiImage
    }

    /// Progress marker that survives a trap: unbuffered stderr.
    private func mark(_ line: String) {
        FileHandle.standardError.write(Data("[NodeViewRenderTests] \(line)\n".utf8))
    }

    nonisolated private static func fixture(_ name: String) throws -> Data {
        let url = try XCTUnwrap(
            Bundle.module.url(
                forResource: name, withExtension: "json", subdirectory: "Fixtures"),
            "missing fixture \(name).json")
        return try Data(contentsOf: url)
    }

    /// Wraps one node in the RNTree envelope and runs the production decoder.
    nonisolated private static func decode(_ nodeJSON: String) throws -> RNNode {
        let tree = try RNTree(wireJSON: Data(#"{"v":1,"seq":0,"root":\#(nodeJSON)}"#.utf8))
        return try XCTUnwrap(tree.root)
    }

    /// One wire node as JSON text. Ids must be unique within a tree.
    nonisolated private static func n(
        _ type: String, id: Int = 1, _ props: String = "{}", _ children: [String] = []
    ) -> String {
        #"{"id":\#(id),"type":"\#(type)","props":\#(props),"children":[\#(children.joined(separator: ","))]}"#
    }

    private struct Hostile {
        /// The root node's type, the prop under attack, its value as authored,
        /// and the line the value targets (NodeView unless another file is
        /// named). "Construction only" marks a line inside a lazy closure
        /// (.toolbar, .alert, .sheet, .swipeActions, navigationDestination)
        /// that a hostless render builds but may never invoke.
        let type: String
        let prop: String
        let value: String
        let why: String
        let json: String
    }

    // A 1x1 transparent PNG — the smallest valid inline bitmap for `Image.data`.
    nonisolated private static let onePixelPNG =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="

    /// Grouped by node type; the group label is documentation, each row
    /// carries its own root type. Shorthand: `H(prop, value, why, props)`
    /// builds a leaf node of H's type; rows needing children build their own.
    private static let hostile: [(type: String, cases: [Hostile])] = {
        func leaf(_ type: String) -> (String, String, String, String) -> Hostile {
            { prop, value, why, props in
                Hostile(type: type, prop: prop, value: value, why: why, json: n(type, props))
            }
        }
        func row(_ type: String, _ prop: String, _ value: String, _ why: String, _ json: String)
            -> Hostile
        {
            Hostile(type: type, prop: prop, value: value, why: why, json: json)
        }
        let text = { (id: Int, s: String) in n("Text", id: id, #"{"text":"\#(s)"}"#) }
        let big = "1e308"
        let neg = "-1e308"
        let deepPath = (1...50).map { "\"/r\($0)\"" }.joined(separator: ",")

        let vstack = leaf("VStack")
        let hstack = leaf("HStack")
        let zstack = leaf("ZStack")
        let txt = leaf("Text")
        let timer = leaf("TimerText")
        let fmt = leaf("FormattedText")
        let button = leaf("Button")
        let toggle = leaf("Toggle")
        let image = leaf("Image")
        let gauge = leaf("Gauge")
        let progress = leaf("ProgressView")
        let section = leaf("Section")
        let label = leaf("Label")
        let unavailable = leaf("ContentUnavailable")
        let labeled = leaf("LabeledContent")
        let grid = leaf("Grid")
        let share = leaf("ShareLink")
        let chart = leaf("Chart")
        let field = leaf("TextField")
        let secure = leaf("SecureField")
        let picker = leaf("Picker")
        let tabs = leaf("TabView")
        let crown = leaf("CrownRotation")
        let slider = leaf("Slider")
        let stepper = leaf("Stepper")
        let date = leaf("DatePicker")
        let map = leaf("Map")
        let nav = leaf("NavigationStack")
        let link = leaf("NavigationLink")
        let alert = leaf("Alert")
        let dialog = leaf("ConfirmationDialog")
        let sheet = leaf("Sheet")

        let groups: [(type: String, cases: [Hostile])] = [
            (
                "VStack/HStack/ZStack",
                [
                    // Spacing only enters layout between two children.
                    row(
                        "VStack", "spacing", big,
                        "L100 cgFloat(spacing) → CGFloat.max in layout math",
                        n("VStack", #"{"spacing":1e308}"#, [text(2, "a"), text(3, "b")])),
                    row(
                        "VStack", "spacing", neg, "L100 negative spacing",
                        n("VStack", #"{"spacing":-1e308}"#, [text(2, "a"), text(3, "b")])),
                    row(
                        "HStack", "spacing", big, "L105 CGFloat.max in horizontal layout math",
                        n("HStack", #"{"spacing":1e308}"#, [text(2, "a"), text(3, "b")])),
                    row(
                        "HStack", "spacing", neg, "L105 negative spacing",
                        n("HStack", #"{"spacing":-1e308}"#, [text(2, "a"), text(3, "b")])),
                    vstack("spacing", "\"8\"", "L100 type mismatch → nil", #"{"spacing":"8"}"#),
                    vstack(
                        "alignment", "diagonal", "RNUI L76 horizontalAlignment default",
                        #"{"alignment":"diagonal"}"#),
                    hstack(
                        "alignment", "middle", "RNUI L84 verticalAlignment default",
                        #"{"alignment":"middle"}"#),
                    zstack(
                        "alignment", "42", "L134 zAlignment on a non-string", #"{"alignment":42}"#),
                    row(
                        "VStack", "children.id", "duplicate ids",
                        "L360 ForEach(node.children) Identifiable collision",
                        n("VStack", "{}", [text(2, "a"), text(2, "b"), text(2, "c")])),
                    // For the record: a collection-backed List raises
                    // NSInternalInconsistencyException on duplicate ids on
                    // iOS 16+; whether watchOS's does is unconfirmed, and
                    // List is UIKit-backed, so this is construction only.
                    row(
                        "List", "children.id", "duplicate ids",
                        "L140 List over ForEach with colliding ids (construction only)",
                        n("List", "{}", [text(2, "a"), text(2, "b")])),
                    row(
                        "VStack", "type", "\"\" / \"vstack\" / \"Bogus\"",
                        "L297 default arm: empty, wrong-case, unknown",
                        n(
                            "VStack", "{}",
                            [n("", id: 2), n("vstack", id: 3), n("Bogus", id: 4, #"{"text":"x"}"#)])
                    ),
                ]
            ),
            (
                "Text",
                [
                    txt(
                        "text", "42", "L111 node.string(text) type mismatch → \"\"", #"{"text":42}"#
                    ),
                    txt(
                        "size", "-20", "RNUI L124 .system(size:) negative",
                        #"{"text":"x","size":-20}"#),
                    txt("size", "0", "RNUI L124 zero point size", #"{"text":"x","size":0}"#),
                    txt(
                        "size", big, "RNUI L124 CGFloat.max font size",
                        #"{"text":"x","size":1e308}"#),
                    txt(
                        "textStyle", "gigantic", "RNStyle.fontStyle unknown → body",
                        #"{"text":"x","textStyle":"gigantic"}"#),
                    txt(
                        "color", "#GGGGGG", "RNStyle.hexRGBA non-hex → nil",
                        ##"{"text":"x","color":"#GGGGGG"}"##),
                    txt(
                        "color", "#FFF", "RNStyle.hexRGBA 3 digits → nil",
                        ##"{"text":"x","color":"#FFF"}"##),
                    txt(
                        "color", "#FFFFFFFFFF", "RNStyle.hexRGBA UInt32 overflow → nil",
                        ##"{"text":"x","color":"#FFFFFFFFFF"}"##),
                    txt("color", "42", "RNUI L128 non-string color", #"{"text":"x","color":42}"#),
                    row(
                        "Text", "children.type", "Bogus",
                        "RNUI L152 textSegment folds any child type by its text prop",
                        n(
                            "Text", #"{"text":"a"}"#,
                            [
                                n("Bogus", id: 2, #"{"text":"b","bold":true}"#),
                                n("Image", id: 3, #"{"systemName":"star"}"#),
                            ])),
                    row(
                        "Text", "children", "3-deep nesting with hostile sizes",
                        "RNUI L156 recursive fold + L164 per-segment size",
                        n(
                            "Text", #"{"text":""}"#,
                            [
                                n(
                                    "Text", id: 2, #"{"text":"","size":-1}"#,
                                    [
                                        n(
                                            "Text", id: 3, #"{"text":"","size":1e308}"#,
                                            [text(4, "deep")])
                                    ])
                            ])),
                ]
            ),
            (
                "TimerText",
                [
                    timer(
                        "until", "0 (past)", "L478 Date()...max(Date(), end) with end in the past",
                        #"{"until":0}"#),
                    timer(
                        "until", big,
                        "L477 end clamped to distantFuture before the countdown formatter",
                        #"{"until":1e308}"#),
                    timer(
                        "until", neg, "L477 negative epoch end clamped to distantPast",
                        #"{"until":-1e308}"#),
                    timer(
                        "since", big, "L483 RNStyle.timerStart clamp (the M3 regression)",
                        #"{"since":1e308}"#),
                    timer("since", neg, "L483 start before distantPast", #"{"since":-1e308}"#),
                    timer(
                        "since", "\"yesterday\"", "L483 type mismatch → nil → epoch 0",
                        #"{"since":"yesterday"}"#),
                    timer(
                        "milliseconds+until", big,
                        "L499 timerInterval huge → RNStyle.formatTimer clampedInt",
                        #"{"milliseconds":true,"until":1e308}"#),
                    timer(
                        "milliseconds+until", neg, "L500 max(0, negative)",
                        #"{"milliseconds":true,"until":-1e308}"#),
                    timer(
                        "milliseconds+since", big,
                        "L503 start in the far future → max(0, negative)",
                        #"{"milliseconds":true,"since":1e308}"#),
                    timer(
                        "milliseconds", "\"true\"", "L460 node.bool on a string → non-ms branch",
                        #"{"milliseconds":"true","since":1000}"#),
                ]
            ),
            (
                "FormattedText",
                [
                    fmt(
                        "date", big, "RNFormat L105 DateFormatter on a year-3e297 Date",
                        #"{"date":1e308}"#),
                    fmt("date", neg, "RNFormat L105 negative epoch", #"{"date":-1e308}"#),
                    fmt(
                        "dateStyle/timeStyle", "epic", "RNFormat L170 unknown style → .none",
                        #"{"date":0,"dateStyle":"epic","timeStyle":"epic"}"#),
                    fmt(
                        "value+format", "1e308 percent", "RNFormat L149 percent of 1e308",
                        #"{"value":1e308,"format":"percent"}"#),
                    fmt(
                        "format", "roman", "RNFormat L151 unknown format → decimal",
                        #"{"value":1,"format":"roman"}"#),
                    fmt(
                        "currency", "NOTACODE", "RNFormat L154 arbitrary currencyCode",
                        #"{"value":1,"format":"currency","currency":"NOTACODE"}"#),
                    fmt(
                        "currency", "\"\"", "RNFormat L153 empty currency code",
                        #"{"value":1,"format":"currency","currency":""}"#),
                    fmt(
                        "min/maxFractionDigits", "1e308 / -1e308",
                        "RNFormat L122-127 clampedInt then min > max",
                        #"{"value":1.5,"minFractionDigits":1e308,"maxFractionDigits":-1e308}"#),
                    fmt(
                        "minFractionDigits", "2.7", "RNFormat L123 fractional digit count",
                        #"{"value":1.5,"minFractionDigits":2.7}"#),
                    fmt("(none)", "{}", "RNFormat L57 neither date nor value → \"\"", "{}"),
                ]
            ),
            (
                "Button",
                [
                    button(
                        "buttonStyle", "neon", "L333 glassStyled default",
                        #"{"buttonStyle":"neon"}"#),
                    button(
                        "primaryAction", "true, no children",
                        "L306 handGestureShortcut on an empty label", #"{"primaryAction":true}"#),
                    row(
                        "Button", "children", "unknown type only",
                        "L352 textContent recursion yields empty a11y label",
                        n("Button", "{}", [n("Bogus", id: 2)])),
                ]
            ),
            (
                "Toggle",
                [
                    toggle(
                        "value", "\"yes\"", "L541 node.bool on a string → false",
                        #"{"value":"yes","label":"x","onChange":true}"#),
                    toggle("label", "42", "L128 non-string label", #"{"label":42,"value":true}"#),
                ]
            ),
            (
                "Image",
                [
                    image(
                        "data", "not base64!!", "L400 Data(base64Encoded:) nil → symbol fallback",
                        #"{"data":"not base64!!"}"#),
                    image(
                        "data", "AAAA (valid base64, not an image)", "L400 UIImage(data:) nil",
                        #"{"data":"AAAA"}"#),
                    image(
                        "data+size", "1x1 PNG, size -5",
                        "L415 .frame(width: -5, height: -5) negative dimension",
                        #"{"data":"\#(onePixelPNG)","size":-5}"#),
                    image(
                        "data+size", "1x1 PNG, size 1e308", "L415 CGFloat.max frame",
                        #"{"data":"\#(onePixelPNG)","size":1e308}"#),
                    image("source", "\"\"", "L417 URL(string: \"\") nil", #"{"source":""}"#),
                    image(
                        "source", "::not a url::", "L417 unparsable URL",
                        #"{"source":"::not a url::"}"#),
                    image(
                        "source+size", "https://example.invalid/x.png, size -1",
                        "L424 negative AsyncImage frame",
                        #"{"source":"https://example.invalid/x.png","size":-1}"#),
                    image(
                        "systemName", "\"\"", "L426 Image(systemName: \"\")", #"{"systemName":""}"#),
                    image(
                        "systemName", "definitely.not.a.symbol", "L426 unknown symbol",
                        #"{"systemName":"definitely.not.a.symbol"}"#),
                    image(
                        "size", "-5 (symbol)", "L427 .system(size: -5)",
                        #"{"systemName":"star","size":-5}"#),
                    image(
                        "size", big, "L427 CGFloat.max symbol size",
                        #"{"systemName":"star","size":1e308}"#),
                    image(
                        "color", "#12", "L428 bad hex → .primary",
                        ##"{"systemName":"star","color":"#12"}"##),
                ]
            ),
            (
                "Gauge",
                [
                    gauge(
                        "min/max", "10 / 0", "L513 RNStyle.gaugeBounds swap",
                        #"{"min":10,"max":0,"value":5}"#),
                    gauge(
                        "min/max", "5 / 5", "L516 zero-width ClosedRange → NaN fraction",
                        #"{"min":5,"max":5,"value":5}"#),
                    gauge("value", big, "L513 clamp to max", #"{"min":0,"max":1,"value":1e308}"#),
                    gauge(
                        "min/max", "-1e308 / 1e308", "L516 max-min overflows to inf",
                        #"{"min":-1e308,"max":1e308,"value":0}"#),
                    // The circular style's arc math sees the same fractions.
                    gauge(
                        "min/max", "5 / 5 (circular)", "L523 accessoryCircular over a NaN fraction",
                        #"{"min":5,"max":5,"value":5,"style":"circular"}"#),
                    gauge(
                        "min/max", "-1e308 / 1e308 (circular)",
                        "L523 accessoryCircular over an inf-width range",
                        #"{"min":-1e308,"max":1e308,"value":0,"style":"circular"}"#),
                    gauge(
                        "value", "1e308 (circular)",
                        "L523 accessoryCircular with the value clamped to max",
                        #"{"min":0,"max":1,"value":1e308,"style":"circular"}"#),
                    gauge(
                        "style", "square", "L522 unknown style → linear",
                        #"{"value":0.5,"style":"square"}"#),
                    gauge("value", "\"half\"", "L515 type mismatch → min", #"{"value":"half"}"#),
                ]
            ),
            (
                "ProgressView",
                [
                    progress(
                        "value/total", "2 / 1", "L147 value above total", #"{"value":2,"total":1}"#),
                    progress("value", "-1", "L147 negative value", #"{"value":-1}"#),
                    progress(
                        "total", "0", "L148 zero total → fraction NaN", #"{"value":1,"total":0}"#),
                    progress("total", "-1", "L148 negative total", #"{"value":0.5,"total":-1}"#),
                    progress(
                        "value/total", "1e308 / 1e308", "L147 huge fraction",
                        #"{"value":1e308,"total":1e308}"#),
                    progress(
                        "value", "\"half\"", "L146 type mismatch → indeterminate",
                        #"{"value":"half"}"#),
                ]
            ),
            (
                "Section/Label/LabeledContent/ContentUnavailable",
                [
                    section(
                        "header/footer", "42 / true", "L173-175 non-string → no header",
                        #"{"header":42,"footer":true}"#),
                    label(
                        "systemName", "\"\"", "L180 empty symbol name",
                        #"{"label":"x","systemName":""}"#),
                    label(
                        "systemName", "nope.symbol", "L180 unknown symbol",
                        #"{"label":"x","systemName":"nope.symbol"}"#),
                    label(
                        "color", "#12", "L182 bad hex → .primary", ##"{"label":"x","color":"#12"}"##
                    ),
                    unavailable(
                        "systemName", "\"\"", "L220 empty symbol name",
                        #"{"title":"x","systemName":"","description":42}"#),
                    labeled("value", "42", "L211 non-string value", #"{"label":"x","value":42}"#),
                    row(
                        "LabeledContent", "children", "unknown type",
                        "L213 childViews over an unsupported child",
                        n("LabeledContent", #"{"label":"x"}"#, [n("Bogus", id: 2)])),
                ]
            ),
            (
                "Grid",
                [
                    row(
                        "Grid", "GridRow cells", "1 vs 3 cells",
                        "L188-190 ragged rows",
                        n(
                            "Grid", "{}",
                            [
                                n("GridRow", id: 2, "{}", [text(3, "a")]),
                                n(
                                    "GridRow", id: 4, "{}",
                                    [text(5, "b"), text(6, "c"), text(7, "d")]),
                            ])),
                    row(
                        "Grid", "children", "no GridRow at all",
                        "L188 required child role missing → empty grid",
                        n("Grid", "{}", [text(2, "stray"), n("Bogus", id: 3)])),
                    row(
                        "Grid", "GridRow", "nested GridRow",
                        "L190 GridRow rendered through NodeView → L203 HStack fallback",
                        n(
                            "Grid", "{}",
                            [n("GridRow", id: 2, "{}", [n("GridRow", id: 3, "{}", [text(4, "x")])])]
                        )),
                    // Two rows of two cells, so both spacings enter layout.
                    row(
                        "Grid", "horizontalSpacing/verticalSpacing", "1e308 / -1e308",
                        "L185-186 cgFloat extremes between cells and rows",
                        n(
                            "Grid", #"{"horizontalSpacing":1e308,"verticalSpacing":-1e308}"#,
                            [
                                n("GridRow", id: 2, "{}", [text(3, "a"), text(4, "b")]),
                                n("GridRow", id: 5, "{}", [text(6, "c"), text(7, "d")]),
                            ])),
                    row(
                        "Grid", "horizontalSpacing/verticalSpacing", "-1e308 / 1e308",
                        "L185-186 cgFloat extremes, axes swapped",
                        n(
                            "Grid", #"{"horizontalSpacing":-1e308,"verticalSpacing":1e308}"#,
                            [
                                n("GridRow", id: 2, "{}", [text(3, "a"), text(4, "b")]),
                                n("GridRow", id: 5, "{}", [text(6, "c"), text(7, "d")]),
                            ])),
                    row(
                        "GridRow", "(standalone)", "cells",
                        "L203 stray row degrades to an HStack",
                        n("GridRow", "{}", [text(2, "a"), text(3, "b")])),
                ]
            ),
            (
                "ShareLink",
                [
                    share("item", "\"\"", "L437-439 ShareLink(item: \"\")", #"{"item":""}"#),
                    share("item", "42", "L437 non-string → \"\"", #"{"item":42}"#),
                    row(
                        "ShareLink", "children", "unknown type",
                        "L441 label from an unsupported child",
                        n("ShareLink", #"{"item":"x"}"#, [n("Bogus", id: 2)])),
                ]
            ),
            (
                "Chart",
                [
                    chart("points", "[]", "L451 Chart over an empty series", #"{"points":[]}"#),
                    chart(
                        "points", "\"nope\"", "RNStyle.chartPoints non-array → []",
                        #"{"points":"nope"}"#),
                    chart(
                        "points[].y", "missing / string / null",
                        "RNStyle L248 y required → all dropped",
                        #"{"points":[{"x":1},{"x":2,"y":"3"},{"x":3,"y":null}]}"#),
                    chart(
                        "points[].x", "string and number mixed",
                        "RNUI L178 categorical + positional marks on one x axis",
                        #"{"points":[{"x":"a","y":1},{"x":2,"y":2},{"y":3}]}"#),
                    chart(
                        "points[].y", "±1e308", "RNUI L190 axis domain width overflows to inf",
                        #"{"points":[{"x":0,"y":1e308},{"x":1,"y":-1e308}]}"#),
                    chart(
                        "points[].y", "1e308 single", "RNUI L190 one point at Double.max",
                        #"{"points":[{"y":1e308}]}"#),
                    chart(
                        "points[].y", "all equal", "RNUI L190 zero-height domain",
                        #"{"points":[{"y":5},{"y":5},{"y":5}]}"#),
                    chart(
                        "points[].x", "±1e308 numeric", "RNUI L206 x domain overflow",
                        #"{"points":[{"x":-1e308,"y":0},{"x":1e308,"y":1}]}"#),
                    chart(
                        "type", "pie", "RNUI L189 unknown kind → LineMark",
                        #"{"type":"pie","points":[{"y":1},{"y":2}]}"#),
                    chart(
                        "type+points", "bar, duplicate labels", "RNUI L181 repeated category",
                        #"{"type":"bar","points":[{"x":"a","y":1},{"x":"a","y":2}]}"#),
                    chart(
                        "color", "#12", "L450 bad hex → accentColor",
                        ##"{"color":"#12","points":[{"y":1}]}"##),
                ]
            ),
            (
                "Toolbar",
                [
                    row(
                        "Toolbar", "ToolbarItem.placement", "sideways / missing / 42",
                        "L1365 unknown placement → filtered out (construction only)",
                        n(
                            "Toolbar", "{}",
                            [
                                n(
                                    "ToolbarItem", id: 2, #"{"placement":"sideways"}"#,
                                    [text(3, "a")]), n("ToolbarItem", id: 4, "{}", [text(5, "b")]),
                                n("ToolbarItem", id: 6, #"{"placement":42}"#, [text(7, "c")]),
                            ])),
                    row(
                        "Toolbar", "children", "non-ToolbarItem",
                        "L1364 required child role missing (construction only)",
                        n("Toolbar", "{}", [text(2, "stray"), n("Bogus", id: 3)])),
                    row(
                        "Toolbar", "ToolbarItem.children", "unknown type in a real slot",
                        "L1368 NodeView over an unsupported toolbar child (construction only)",
                        n(
                            "Toolbar", "{}",
                            [
                                n(
                                    "ToolbarItem", id: 2, #"{"placement":"bottomBar"}"#,
                                    [n("Bogus", id: 3)])
                            ])),
                ]
            ),
            (
                "TextField/SecureField",
                [
                    field(
                        "value", "42", "L1079 non-string value → \"\"",
                        #"{"value":42,"placeholder":true,"onChange":true}"#),
                    field(
                        "autoFocus", "true", "L1097 focus task on a hostless render",
                        #"{"value":"x","autoFocus":true,"onChange":true}"#),
                    secure(
                        "value", "42", "L1079 SecureField non-string value",
                        #"{"value":42,"onChange":true}"#),
                    secure(
                        "placeholder", "1e308", "L1104 non-string placeholder",
                        #"{"placeholder":1e308}"#),
                ]
            ),
            (
                "Picker",
                [
                    picker(
                        "options/value", "[] / 3", "L239 0..<0 with a selection no tag matches",
                        #"{"options":[],"value":3,"onChange":true}"#),
                    picker(
                        "value", "7 of 2 options", "L237 selection outside options",
                        #"{"options":["a","b"],"value":7,"onChange":true}"#),
                    picker(
                        "value", "-1", "L674 negative selection",
                        #"{"options":["a","b"],"value":-1,"onChange":true}"#),
                    picker(
                        "value", "1.5", "L674 RNStyle.clampedInt truncation",
                        #"{"options":["a","b"],"value":1.5,"onChange":true}"#),
                    picker(
                        "value", big, "L674 clampedInt → Int.max",
                        #"{"options":["a","b"],"value":1e308,"onChange":true}"#),
                    picker(
                        "value", neg, "L674 clampedInt → Int.min",
                        #"{"options":["a","b"],"value":-1e308,"onChange":true}"#),
                    picker(
                        "options", "[1, \"a\", null, true]", "L238 stringArray drops non-strings",
                        #"{"options":[1,"a",null,true],"value":0,"onChange":true}"#),
                    picker(
                        "options", "\"abc\"", "L238 non-array → []",
                        #"{"options":"abc","value":0,"onChange":true}"#),
                    picker(
                        "onChange", "absent", "L57 handlerless control → disabled",
                        #"{"options":["a"],"value":0}"#),
                ]
            ),
            (
                "TabView",
                [
                    row(
                        "TabView", "selection", "5 of 2 pages",
                        "L254-258 selection no tag matches",
                        n(
                            "TabView", #"{"selection":5,"onChange":true}"#,
                            [text(2, "a"), text(3, "b")])),
                    row(
                        "TabView", "selection", big,
                        "L691 clampedInt → Int.max tag",
                        n("TabView", #"{"selection":1e308,"onChange":true}"#, [text(2, "a")])),
                    row(
                        "TabView", "selection", neg,
                        "L691 clampedInt → Int.min tag",
                        n("TabView", #"{"selection":-1e308,"onChange":true}"#, [text(2, "a")])),
                    tabs(
                        "selection", "0, no children", "L255 empty enumerated ForEach",
                        #"{"selection":0,"onChange":true}"#),
                    row(
                        "TabView", "style", "carousel",
                        "L727 unknown style → no modifier",
                        n("TabView", #"{"style":"carousel"}"#, [text(2, "a")])),
                    row(
                        "TabView", "children.id", "duplicate ids",
                        "L256 ForEach id: \\.element.id collision",
                        n(
                            "TabView", #"{"selection":0,"onChange":true}"#,
                            [text(2, "a"), text(2, "b")])),
                ]
            ),
            (
                "CrownRotation",
                [
                    crown(
                        "step", "0", "L1163 digitalCrownRotation(by: 0)",
                        #"{"min":0,"max":10,"step":0,"value":5,"onChange":true}"#),
                    crown(
                        "step", "-1", "L1163 negative step",
                        #"{"min":0,"max":10,"step":-1,"value":5,"onChange":true}"#),
                    crown(
                        "step", big, "L1163 step wider than the range",
                        #"{"min":0,"max":10,"step":1e308,"value":5,"onChange":true}"#),
                    crown(
                        "min/max", "5 / 5", "L1161-1162 from == through",
                        #"{"min":5,"max":5,"value":5,"onChange":true}"#),
                    crown(
                        "min/max", "1e308 / -1e308", "L1161-1162 reversed extremes",
                        #"{"min":1e308,"max":-1e308,"value":0,"onChange":true}"#),
                    crown(
                        "value", big, "L1197 value outside bounds",
                        #"{"min":0,"max":10,"value":1e308,"onChange":true}"#),
                    crown(
                        "haptic", "\"yes\"", "L1166 node.bool on a string → default true",
                        #"{"haptic":"yes","onChange":true}"#),
                    row(
                        "CrownRotation", "focused", "true",
                        "L1171-1181 focus claim on a hostless render",
                        n(
                            "CrownRotation",
                            #"{"focused":true,"onFocusChange":true,"onChange":true}"#,
                            [text(2, "x")])),
                ]
            ),
            (
                "Slider",
                [
                    slider(
                        "step", "0", "L273 Slider(value:in:step: 0)",
                        #"{"min":0,"max":1,"step":0,"value":0.5,"onChange":true}"#),
                    slider(
                        "step", "-1", "L273 negative step",
                        #"{"min":0,"max":1,"step":-1,"value":0.5,"onChange":true}"#),
                    slider(
                        "step", big, "L273 step wider than the range",
                        #"{"min":0,"max":1,"step":1e308,"value":0.5,"onChange":true}"#),
                    slider(
                        "step", "\"1\"", "L272 type mismatch → no-step Slider",
                        #"{"min":0,"max":1,"step":"1","value":0.5,"onChange":true}"#),
                    slider(
                        "min/max", "0 / 0", "L271 zero-width range → NaN normalized value",
                        #"{"min":0,"max":0,"value":0,"onChange":true}"#),
                    slider(
                        "min/max", "1 / 0", "L271 reversed → swapped",
                        #"{"min":1,"max":0,"value":0.5,"onChange":true}"#),
                    slider(
                        "min/max", "-1e308 / 1e308", "L271 range width overflows to inf",
                        #"{"min":-1e308,"max":1e308,"value":0,"onChange":true}"#),
                    slider(
                        "value", big, "L658 value outside the range",
                        #"{"min":0,"max":1,"value":1e308,"onChange":true}"#),
                    slider(
                        "value", "-5", "L658 value below the range",
                        #"{"min":0,"max":1,"value":-5,"onChange":true}"#),
                ]
            ),
            (
                "Stepper",
                [
                    stepper(
                        "step", "0", "L283 Stepper(step: 0)",
                        #"{"min":0,"max":10,"step":0,"value":5,"onChange":true}"#),
                    stepper(
                        "step", "-1", "L283 negative step",
                        #"{"min":0,"max":10,"step":-1,"value":5,"onChange":true}"#),
                    stepper(
                        "min/max", "5 / 5", "L282 zero-width range",
                        #"{"min":5,"max":5,"value":5,"onChange":true}"#),
                    stepper(
                        "min/max", "10 / 0", "L282 reversed → swapped",
                        #"{"min":10,"max":0,"value":5,"onChange":true}"#),
                    stepper(
                        "value", big, "L658 value outside the range",
                        #"{"min":0,"max":10,"value":1e308,"onChange":true}"#),
                    stepper(
                        "min/max/step", "-1e308 / 1e308 / 1e308", "L280-283 extremes",
                        #"{"min":-1e308,"max":1e308,"step":1e308,"value":0,"onChange":true}"#),
                ]
            ),
            (
                "DatePicker",
                [
                    date(
                        "mode", "century", "L623 dateComponents default → logs once",
                        #"{"mode":"century","value":0,"onChange":true}"#),
                    date(
                        "value", big,
                        "L659 dateBinding clamps to distantFuture (a 1e305-second Date in Calendar trapped)",
                        #"{"value":1e308,"onChange":true}"#),
                    date(
                        "value", neg, "L659 dateBinding clamps to distantPast",
                        #"{"value":-1e308,"onChange":true}"#),
                    date(
                        "value", "\"yesterday\"", "L642 type mismatch → epoch 0",
                        #"{"value":"yesterday","onChange":true}"#),
                    date(
                        "mode", "hourAndMinute, value 1e308", "L620 time wheel on the clamped date",
                        #"{"mode":"hourAndMinute","value":1e308,"onChange":true}"#),
                ]
            ),
            (
                "Map",
                [
                    // mapRegion's guard: MapKit's "Invalid Region" exception
                    // lives in the platform view, which this harness never
                    // instantiates; the rows evaluate the guard, not MapKit.
                    map(
                        "latitude/longitude", "91 / 181",
                        "L588 invalid center → nil region (auto-fit)",
                        #"{"latitude":91,"longitude":181}"#),
                    map(
                        "latitude", neg, "L588 CLLocationCoordinate2DIsValid far outside ±90",
                        #"{"latitude":-1e308,"longitude":0}"#),
                    map(
                        "span", "-1", "L588 negative span → nil region",
                        #"{"latitude":0,"longitude":0,"span":-1}"#),
                    map(
                        "span", "0", "L588 zero span → nil region",
                        #"{"latitude":0,"longitude":0,"span":0}"#),
                    map(
                        "span", big, "L588 span beyond 180° → nil region",
                        #"{"latitude":0,"longitude":0,"span":1e308}"#),
                    map(
                        "span", "180", "L588 the widest span the guard accepts",
                        #"{"latitude":0,"longitude":0,"span":180}"#),
                    map(
                        "annotations[].lat", "999", "L611 Marker at an invalid coordinate",
                        #"{"annotations":[{"lat":999,"lon":999,"title":"x"}]}"#),
                    map(
                        "annotations[].lat", "\"12\"", "L603 non-number → dropped",
                        #"{"annotations":[{"lat":"12","lon":"34"}]}"#),
                    map(
                        "annotations", "\"nope\"", "L600 non-array → []",
                        #"{"annotations":"nope","route":42}"#),
                    map(
                        "annotations", "duplicate id", "L594 two pins share coordinate+title id",
                        #"{"annotations":[{"lat":1,"lon":1,"title":"x"},{"lat":1,"lon":1,"title":"x"}]}"#
                    ),
                    map(
                        "annotations[].tint", "#ZZ", "L561 bad tint → .red",
                        ##"{"annotations":[{"lat":1,"lon":1,"tint":"#ZZ","systemImage":""}]}"##),
                    map(
                        "route", "1 point", "L986 count > 1 guard",
                        #"{"route":[{"lat":1,"lon":1}]}"#),
                    map(
                        "route", "invalid coordinates", "L987 MapPolyline over ±999",
                        #"{"route":[{"lat":999,"lon":-999},{"lat":-999,"lon":999}]}"#),
                    map("height", "-50", "L570 negative frame height", #"{"height":-50}"#),
                    map("height", big, "L570 CGFloat.max height", #"{"height":1e308}"#),
                    map(
                        "fullScreen", "true", "L992 infinite frame + ignoresSafeArea",
                        #"{"fullScreen":true,"showsUserLocation":true,"followsUserLocation":true,"onPress":true}"#
                    ),
                    map(
                        "cameraTrigger", big, "L569 camera key from 1e308",
                        #"{"latitude":0,"longitude":0,"cameraTrigger":1e308}"#),
                ]
            ),
            (
                "NavigationStack",
                [
                    nav(
                        "path", "\"not-an-array\"", "L810-811 present but non-array → []",
                        #"{"path":"not-an-array"}"#),
                    row(
                        "NavigationStack", "path", "[\"/nowhere\"]",
                        "L799 MissingNavigationRoute for a confirmed unknown route (construction only)",
                        n("NavigationStack", #"{"path":["/nowhere"]}"#, [text(2, "root")])),
                    row(
                        "NavigationStack", "path", "[42, null, \"x\", \"\"]",
                        "L811 stringArray drops non-strings, L906 filters \"/\"",
                        n(
                            "NavigationStack", #"{"path":[42,null,"x",""]}"#,
                            [n("NavigationRoute", id: 2, #"{"path":"/x"}"#, [text(3, "x")])])),
                    row(
                        "NavigationStack", "NavigationRoute.path", "no \"/\" route",
                        "L875-881 rootRoute nil → non-route children (none)",
                        n(
                            "NavigationStack", "{}",
                            [n("NavigationRoute", id: 2, #"{"path":"/a"}"#, [text(3, "a")])])),
                    row(
                        "NavigationStack", "NavigationRoute.path", "two \"/\" routes",
                        "L875 first wins",
                        n(
                            "NavigationStack", "{}",
                            [
                                n("NavigationRoute", id: 2, #"{"path":"/"}"#, [text(3, "a")]),
                                n("NavigationRoute", id: 4, #"{"path":"/"}"#, [text(5, "b")]),
                            ])),
                    row(
                        "NavigationStack", "NavigationRoute.path", "[ / [[...]] / [...] / [] / 42",
                        "L894-896 RouteMatcher.parse on unnamed/unbalanced patterns (construction only; the parser itself is pinned in SupportTests)",
                        n(
                            "NavigationStack", #"{"path":["/a/b"]}"#,
                            [
                                n("NavigationRoute", id: 2, #"{"path":"["}"#, [text(3, "1")]),
                                n(
                                    "NavigationRoute", id: 4, #"{"path":"/[[...]]"}"#,
                                    [text(5, "2")]),
                                n("NavigationRoute", id: 6, #"{"path":"/[...]"}"#, [text(7, "3")]),
                                n("NavigationRoute", id: 8, #"{"path":"/[]/[]"}"#, [text(9, "4")]),
                                n("NavigationRoute", id: 10, #"{"path":42}"#, [text(11, "5")]),
                                n(
                                    "NavigationRoute", id: 12, #"{"path":"/[...rest]"}"#,
                                    [text(13, "6")]),
                            ])),
                    row(
                        "NavigationStack", "path", "50 pushed routes",
                        "L759 NavigationStack(path:) with a deep controlled path",
                        n(
                            "NavigationStack", #"{"path":[\#(deepPath)]}"#,
                            [n("NavigationRoute", id: 2, #"{"path":"/[id]"}"#, [text(3, "x")])])),
                    row(
                        "NavigationStack", "title", "42",
                        "L884 non-string title → \"\"",
                        n("NavigationStack", #"{"title":42}"#, [text(2, "x")])),
                    link("to", "\"\"", "L366 NavigationLink(value: \"\")", #"{"to":""}"#),
                    link("to", "42", "L379 non-string → label fallback \"\"", #"{"to":42}"#),
                    row(
                        "NavigationLink", "children", "unknown type",
                        "L381 label from an unsupported child",
                        n("NavigationLink", #"{"to":"/x"}"#, [n("Bogus", id: 2)])),
                    row(
                        "NavigationRoute", "(standalone)", "full-screen Map child",
                        "L1034 ownsFullScreen bypasses the ScrollView",
                        n(
                            "NavigationRoute", #"{"path":"/m"}"#,
                            [n("Map", id: 2, #"{"fullScreen":true}"#)])),
                    row(
                        "NavigationRoute", "(standalone)", "ZStack over a full-screen Map",
                        "L1039-1040 ZStack branch",
                        n(
                            "NavigationRoute", "{}",
                            [
                                n(
                                    "ZStack", id: 2, "{}",
                                    [n("Map", id: 3, #"{"fullScreen":true}"#), text(4, "hud")])
                            ])),
                    row(
                        "NavigationRoute", "(standalone)", "no children, title 42",
                        "L1013 children.first nil → empty ScrollView",
                        n("NavigationRoute", #"{"title":42}"#)),
                ]
            ),
            (
                "Alert/ConfirmationDialog/Sheet",
                [
                    row(
                        "Alert", "AlertAction.role", "primary / 42",
                        "L1471 buttonRole default; L1453 non-string label (construction only)",
                        n(
                            "Alert",
                            #"{"title":"t","message":42,"presented":true,"onChange":true}"#,
                            [
                                n("AlertAction", id: 2, #"{"label":"a","role":"primary"}"#),
                                n("AlertAction", id: 3, #"{"label":42,"role":42}"#),
                            ])),
                    row(
                        "Alert", "children", "non-AlertAction",
                        "L1451 required child role missing → no buttons (construction only)",
                        n(
                            "Alert", #"{"title":"t","presented":true,"onChange":true}"#,
                            [text(2, "stray"), n("Bogus", id: 3)])),
                    alert(
                        "presented", "true, no onChange",
                        "L1433 handlerless presentation never presents",
                        #"{"title":"t","presented":true}"#),
                    alert(
                        "title", "42", "L1385 non-string title",
                        #"{"title":42,"presented":"yes","onChange":true}"#),
                    row(
                        "ConfirmationDialog", "presented", "true",
                        "L1388 dialog presented on a hostless render (construction only)",
                        n(
                            "ConfirmationDialog",
                            #"{"title":"t","presented":true,"onChange":true}"#,
                            [
                                n("AlertAction", id: 2, #"{"label":"x","role":"destructive"}"#),
                                n("AlertAction", id: 3, #"{"label":"y","role":"cancel"}"#),
                            ])),
                    dialog("title", "42", "L1385 non-string title", #"{"title":42}"#),
                    row(
                        "Sheet", "presented", "true",
                        "L1413 sheet presented on a hostless render with hostile content (construction only)",
                        n(
                            "Sheet", #"{"presented":true,"onChange":true}"#,
                            [n("Bogus", id: 2), text(3, "x")])),
                    sheet(
                        "presented", "\"yes\"", "L1434 node.bool on a string → false",
                        #"{"presented":"yes","onChange":true}"#),
                    row(
                        "AlertAction", "(standalone)", "role destructive",
                        "L166 EmptyView outside an Alert",
                        n("AlertAction", #"{"label":"x","role":"destructive"}"#)),
                ]
            ),
            (
                "Text (LayoutModifier / shared modifier props)",
                [
                    txt(
                        "padding", big, "L1550 .padding(CGFloat.max)",
                        #"{"text":"x","padding":1e308}"#),
                    txt(
                        "padding", neg, "L1550 negative padding", #"{"text":"x","padding":-1e308}"#),
                    txt(
                        "padding", "{\"horizontal\": 1e308}", "L1553 per-axis extreme",
                        #"{"text":"x","padding":{"horizontal":1e308,"vertical":-1e308}}"#),
                    txt(
                        "padding", "{\"horizontal\": \"8\"}",
                        "RNStyle L146 non-number → nil insets",
                        #"{"text":"x","padding":{"horizontal":"8"}}"#),
                    txt(
                        "padding", "\"8\"", "RNStyle L150 non-number non-object → nil",
                        #"{"text":"x","padding":"8"}"#),
                    txt(
                        "cornerRadius", "-10", "L1572 RoundedRectangle(cornerRadius: -10) clip",
                        #"{"text":"x","cornerRadius":-10}"#),
                    txt(
                        "cornerRadius", big, "L1572 CGFloat.max radius",
                        #"{"text":"x","cornerRadius":1e308}"#),
                    txt(
                        "background+cornerRadius", "#123456 / -1e308",
                        "L1567 background in a negative-radius shape",
                        ##"{"text":"x","background":"#123456","cornerRadius":-1e308}"##),
                    txt(
                        "background", "#12", "L1496 bad hex → no background",
                        ##"{"text":"x","background":"#12"}"##),
                    txt("opacity", "-1", "L1501 negative opacity", #"{"text":"x","opacity":-1}"#),
                    txt("opacity", big, "L1501 opacity 1e308", #"{"text":"x","opacity":1e308}"#),
                    txt(
                        "frame.width", "-50", "L1586 negative frame dimension",
                        #"{"text":"x","frame":{"width":-50,"height":-50}}"#),
                    txt(
                        "frame.width", big, "L1586 CGFloat.max frame",
                        #"{"text":"x","frame":{"width":1e308,"height":1e308}}"#),
                    txt(
                        "frame.maxWidth", "\"infinity\", width 0",
                        "L1590 infinity fill + zero fixed width",
                        #"{"text":"x","frame":{"width":0,"maxWidth":"infinity","maxHeight":"infinity"}}"#
                    ),
                    txt(
                        "frame.maxWidth", "\"huge\"",
                        "RNStyle L191 unknown string → not infinity, not a number",
                        #"{"text":"x","frame":{"maxWidth":"huge","maxHeight":-1e308}}"#),
                    txt("frame", "{}", "RNStyle L194 empty → nil", #"{"text":"x","frame":{}}"#),
                    txt(
                        "frame", "\"big\"", "RNStyle L185 non-object → nil",
                        #"{"text":"x","frame":"big"}"#),
                    txt(
                        "animation.duration", "0 (spring)", "L1531 .spring(duration: 0)",
                        #"{"text":"x","animation":{"kind":"spring","duration":0}}"#),
                    txt(
                        "animation.duration", "-1 (spring)", "L1531 negative spring duration",
                        #"{"text":"x","animation":{"kind":"spring","duration":-1}}"#),
                    txt(
                        "animation.duration", "1e308 (ease)", "L1533 .easeInOut(duration: 1e308)",
                        #"{"text":"x","animation":{"kind":"ease","duration":1e308}}"#),
                    txt(
                        "animation.duration", "-1e308 (linear)", "L1539 negative linear duration",
                        #"{"text":"x","animation":{"kind":"linear","duration":-1e308}}"#),
                    txt(
                        "animation.kind", "bounce", "RNStyle L222 unknown kind → nil",
                        #"{"text":"x","animation":{"kind":"bounce"}}"#),
                    txt(
                        "animation", "\"spring\"", "RNStyle L220 non-object → nil",
                        #"{"text":"x","animation":"spring"}"#),
                    txt("tint", "#GG", "L1502 bad hex → no tint", ##"{"text":"x","tint":"#GG"}"##),
                    txt(
                        "glass+ignoresSafeArea", "true",
                        "L59 GlassModifier, L1504 SafeAreaModifier",
                        #"{"text":"x","glass":true,"ignoresSafeArea":true}"#),
                    txt(
                        "accessibilityLabel/Hint", "42 / true", "L62-63 non-string → nil",
                        #"{"text":"x","accessibilityLabel":42,"accessibilityHint":true}"#),
                    txt(
                        "swipeActionLabel", "with empty symbol + bad tint",
                        "L1327-1333 Label(systemImage: \"\"), tint nil (construction only: .swipeActions is a no-op outside a List)",
                        ##"{"text":"x","swipeActionLabel":"del","swipeActionSystemImage":"","swipeActionTint":"#GG","leadingSwipeActionLabel":"pin","leadingSwipeActionTint":"nope"}"##
                    ),
                    txt(
                        "gestures", "all flags true", "L1221-1240 GestureModifier every branch",
                        #"{"text":"x","onLongPress":true,"onSwipe":true,"onDrag":true,"focusable":true}"#
                    ),
                    txt(
                        "gestures", "\"true\" strings", "L1221 node.bool on strings → untouched",
                        #"{"text":"x","onLongPress":"true","onSwipe":"true","focusable":"true"}"#),
                ]
            ),
        ]
        return groups
    }()
}
#endif
