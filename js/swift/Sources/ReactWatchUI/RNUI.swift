// watchOS-only shared SwiftUI mapping for the two React interpreters
// (ReactWatchHost's NodeView and ReactWatchWidget's WidgetNodeView). These
// helpers were byte-for-byte (or near-) identical copies in both files; sharing
// one implementation makes their parity STRUCTURAL (ARCH-10 Phase A) instead of
// enforced by a golden test — e.g. the rich-text `textSegment` fold, which had
// silently drifted between the two copies (the widget dropped >=2-deep nesting).
//
// Scope is deliberately Phase A: pure value mappings only (a node or a name ->
// a SwiftUI value). The render *switch* and all interactive/event/navigation
// logic stay in each interpreter — unifying those behind a RenderContext is the
// higher-risk Phase B, wanted only once a second interpreter target exists.
//
// Compiles fully for the watchOS destination and to an empty module elsewhere,
// like its two callers (so `swift test`/`swift build` still run on Linux/macOS).
#if os(watchOS)
import Charts
import ReactWatchCore
import ReactWatchSupport
import SwiftUI

/// Namespace for the shared interpreter helpers. `RNUI.x` at every call site.
public enum RNUI {
    /// Named-set + `#RRGGBB[AA]` hex color parsing (the shared `RNStyle` kernel)
    /// mapped to a SwiftUI `Color`; nil when the value is neither a known name
    /// nor valid hex, so callers fall back to `.primary`/`.accentColor`.
    public static func color(_ name: String?) -> Color? {
        guard let value = RNStyle.color(name) else { return nil }
        switch value {
        case .named(let named): return systemColor(named)
        case .rgba(let r, let g, let b, let a):
            return Color(red: r, green: g, blue: b, opacity: a)
        }
    }

    /// A known `RNStyle` named color -> its SwiftUI system color.
    public static func systemColor(_ name: String) -> Color {
        switch name {
        case "red": .red
        case "orange": .orange
        case "yellow": .yellow
        case "green": .green
        case "mint": .mint
        case "teal": .teal
        case "cyan": .cyan
        case "blue": .blue
        case "indigo": .indigo
        case "purple": .purple
        case "pink": .pink
        case "brown": .brown
        case "white": .white
        case "gray": .gray
        case "black": .black
        case "primary": .primary
        case "secondary": .secondary
        case "accentColor": .accentColor
        default: .primary
        }
    }

    /// Semantic `textStyle` -> SwiftUI `Font` (scales with Dynamic Type).
    public static func semanticFont(_ style: String) -> Font {
        switch RNStyle.fontStyle(style) {
        case .largeTitle: .largeTitle
        case .title: .title
        case .title2: .title2
        case .title3: .title3
        case .headline: .headline
        case .callout: .callout
        case .subheadline: .subheadline
        case .footnote: .footnote
        case .caption: .caption
        case .body: .body
        }
    }

    public static func horizontalAlignment(_ name: String?) -> HorizontalAlignment {
        switch name {
        case "leading": .leading
        case "trailing": .trailing
        default: .center
        }
    }

    public static func verticalAlignment(_ name: String?) -> VerticalAlignment {
        switch name {
        case "top": .top
        case "bottom": .bottom
        case "firstTextBaseline": .firstTextBaseline
        default: .center
        }
    }

    public static func zAlignment(_ name: String?) -> Alignment {
        switch name {
        case "topLeading": .topLeading
        case "top": .top
        case "topTrailing": .topTrailing
        case "leading": .leading
        case "trailing": .trailing
        case "bottomLeading": .bottomLeading
        case "bottom": .bottom
        case "bottomTrailing": .bottomTrailing
        default: .center
        }
    }

    /// Applies a node's own text styling to a base `Text` (the whole rich-text
    /// concatenation) — the outermost layer over `textSegment`'s children.
    public static func styled(_ node: RNNode, _ base: Text) -> some View {
        var text = base
        if node.bool("bold") == true { text = text.bold() }
        if node.bool("monospacedDigit") == true { text = text.monospacedDigit() }
        if let style = node.string("textStyle") {
            text = text.font(semanticFont(style))
        } else if let size = node.double("size") {
            text = text.font(.system(size: CGFloat(size)))
        }
        return text.foregroundStyle(color(node.string("color")) ?? .primary)
    }

    /// One rich-text segment as a concatenable `Text`. Recurses into a segment's
    /// element children first (a nested `<Text>` has text="" and carries its
    /// content as children), then layers this node's own styling; color only
    /// when the segment sets one, so plain segments inherit the outer style.
    /// The recursion is the parity-critical bit — the widget copy used to skip
    /// it, dropping text nested >=2 deep on the complication.
    public static func textSegment(_ node: RNNode) -> Text {
        var text =
            node.children.isEmpty
            ? Text(node.string("text") ?? "")
            : node.children.reduce(Text(node.string("text") ?? "")) {
                $0 + textSegment($1)
            }
        if node.bool("bold") == true { text = text.bold() }
        if node.bool("monospacedDigit") == true { text = text.monospacedDigit() }
        if let style = node.string("textStyle") {
            text = text.font(semanticFont(style))
        } else if let size = node.double("size") {
            text = text.font(.system(size: CGFloat(size)))
        }
        if let segmentColor = color(node.string("color")) {
            text = text.foregroundStyle(segmentColor)
        }
        return text
    }

    /// One chart mark for a series point. Categorical (string `x`/label) and
    /// positional (numeric/absent `x`) points branch because `PlottableValue`
    /// is generic over the x type.
    @ChartContentBuilder public static func chartMark(
        kind: String, point: RNStyle.ChartPoint, index: Int, color: Color
    ) -> some ChartContent {
        if let label = point.label {
            switch kind {
            case "bar":
                BarMark(x: .value("x", label), y: .value("y", point.y))
                    .foregroundStyle(color)
            case "area":
                AreaMark(x: .value("x", label), y: .value("y", point.y))
                    .foregroundStyle(color)
            case "point":
                PointMark(x: .value("x", label), y: .value("y", point.y))
                    .foregroundStyle(color)
            default:
                LineMark(x: .value("x", label), y: .value("y", point.y))
                    .foregroundStyle(color)
            }
        } else {
            let x = point.x ?? Double(index)
            switch kind {
            case "bar":
                BarMark(x: .value("x", x), y: .value("y", point.y))
                    .foregroundStyle(color)
            case "area":
                AreaMark(x: .value("x", x), y: .value("y", point.y))
                    .foregroundStyle(color)
            case "point":
                PointMark(x: .value("x", x), y: .value("y", point.y))
                    .foregroundStyle(color)
            default:
                LineMark(x: .value("x", x), y: .value("y", point.y))
                    .foregroundStyle(color)
            }
        }
    }
}
#endif
