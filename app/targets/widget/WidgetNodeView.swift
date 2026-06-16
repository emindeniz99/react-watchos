import SwiftUI
import UIKit

/// Non-interactive interpreter for React-rendered widget trees. Same node
/// vocabulary as the watch app's NodeView, minus events (WidgetKit views
/// are static) and navigation. nil renders the placeholder.
struct WidgetNodeView: View {
    let node: RNNode?

    var body: some View {
        if let node {
            applyA11y(render(node), node)
        } else {
            // Placeholder/redacted state before the app publishes data.
            Image(systemName: "drop")
        }
    }

    @ViewBuilder private func applyA11y(
        _ content: some View, _ node: RNNode
    ) -> some View {
        if let label = node.string("accessibilityLabel") {
            content.accessibilityLabel(label)
        } else {
            content
        }
    }

    @ViewBuilder private func render(_ node: RNNode) -> some View {
        switch node.type {
        case "VStack":
            VStack(spacing: cgFloat(node, "spacing")) { children(node) }
        case "HStack":
            HStack(spacing: cgFloat(node, "spacing")) { children(node) }
        case "ZStack":
            ZStack { children(node) }
        case "Text":
            styled(node, Text(node.string("text") ?? ""))
        case "TimerText":
            timerText(node)
        case "Image":
            // Widgets can't load remote images (no async at render time), so
            // a `source` URL falls back to a symbol; base64 `data` works.
            if let b64 = node.string("data"),
               let data = Data(base64Encoded: b64),
               let ui = UIImage(data: data) {
                Image(uiImage: ui).resizable().scaledToFit()
                    .frame(width: cgFloat(node, "size"), height: cgFloat(node, "size"))
            } else {
                Image(systemName: node.string("systemName") ?? "photo")
                    .font(.system(size: CGFloat(node.double("size") ?? 17)))
                    .foregroundStyle(color(node.string("color")) ?? .primary)
            }
        case "Spacer":
            Spacer(minLength: 0)
        case "Divider":
            Divider()
        case "Gauge":
            gauge(node)
        case "ProgressView":
            if let value = node.double("value") {
                ProgressView(value: value, total: node.double("total") ?? 1)
            } else {
                ProgressView()
            }
        // Interactive/navigation nodes degrade to their content.
        case "Button", "NavigationStack", "NavigationLink", "ScrollView",
             "List", "TabView", "CrownRotation":
            children(node)
        case "Toggle":
            Text(node.string("label") ?? "")
        case "Slider", "Stepper":
            // Read-only in widgets: show the value as a fraction.
            let lo = node.double("from") ?? 0
            let hi = node.double("through") ?? 1
            let v = node.double("value") ?? 0
            ProgressView(value: max(0, min(1, hi > lo ? (v - lo) / (hi - lo) : 0)))
        case "TextField":
            Text(node.string("value") ?? node.string("placeholder") ?? "")
        case "Picker":
            Text(pickerSummary(node))
        default:
            EmptyView()
        }
    }

    @ViewBuilder private func children(_ node: RNNode) -> some View {
        ForEach(node.children) { child in
            WidgetNodeView(node: child)
        }
    }

    @ViewBuilder private func gauge(_ node: RNNode) -> some View {
        let min = node.double("min") ?? 0
        let max = node.double("max") ?? 1
        let value = Swift.min(Swift.max(node.double("value") ?? 0, min), max)
        let base = Gauge(value: value, in: min...max) {
            Text(node.string("label") ?? "")
        } currentValueLabel: {
            Text(formatted(value))
        }
        .tint(color(node.string("color")) ?? .accentColor)
        // Accessory families dictate the rendered shape; circular keeps
        // parity with the in-app style prop.
        if node.string("style") == "circular" {
            base.gaugeStyle(.accessoryCircular)
        } else {
            base.gaugeStyle(.accessoryLinear)
        }
    }

    private func styled(_ node: RNNode, _ base: Text) -> some View {
        var text = base
        if node.bool("bold") == true { text = text.bold() }
        if let style = node.string("textStyle") {
            text = text.font(semanticFont(style))
        } else if let size = node.double("size") {
            text = text.font(.system(size: CGFloat(size)))
        }
        return text.foregroundStyle(color(node.string("color")) ?? .primary)
    }

    private func semanticFont(_ style: String) -> Font {
        switch style {
        case "largeTitle": .largeTitle
        case "title": .title
        case "title2": .title2
        case "title3": .title3
        case "headline": .headline
        case "callout": .callout
        case "subheadline": .subheadline
        case "footnote": .footnote
        case "caption": .caption
        default: .body
        }
    }

    // Auto-updating timer label; valid in widgets (Text(timerInterval:) is
    // one of the few views WidgetKit ticks without a timeline reload).
    @ViewBuilder private func timerText(_ node: RNNode) -> some View {
        if let until = node.double("until") {
            let end = Date(timeIntervalSince1970: until / 1000)
            styled(node, Text(timerInterval: Date()...Swift.max(Date(), end),
                              countsDown: true))
        } else {
            let start = Date(timeIntervalSince1970: (node.double("since") ?? 0) / 1000)
            styled(node, Text(timerInterval: start...Date.distantFuture,
                              countsDown: false))
        }
    }

    private func pickerSummary(_ node: RNNode) -> String {
        let options = node.stringArray("options") ?? []
        let index = Int(node.double("value") ?? 0)
        if options.indices.contains(index) { return options[index] }
        return node.string("label") ?? ""
    }

    private func formatted(_ value: Double) -> String {
        value.truncatingRemainder(dividingBy: 1) == 0
            ? String(Int(value)) : String(format: "%.1f", value)
    }

    private func cgFloat(_ node: RNNode, _ key: String) -> CGFloat? {
        node.double(key).map { CGFloat($0) }
    }

    private func color(_ name: String?) -> Color? {
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
        default: nil
        }
    }
}
