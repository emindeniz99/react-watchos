import ReactWatchCore
import ReactWatchSupport
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
        if let label = node.string("accessibilityLabel"),
            let hint = node.string("accessibilityHint")
        {
            content.accessibilityLabel(label).accessibilityHint(hint)
        } else if let label = node.string("accessibilityLabel") {
            content.accessibilityLabel(label)
        } else if let hint = node.string("accessibilityHint") {
            content.accessibilityHint(hint)
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
                let ui = UIImage(data: data)
            {
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
        case "Button", "NavigationStack", "NavigationLink", "NavigationRoute",
            "ScrollView", "List", "TabView", "CrownRotation":
            children(node)
        case "Toggle":
            Text(node.string("label") ?? "")
        case "Slider", "Stepper":
            // Read-only in widgets: show the value as a fraction.
            let lo = node.double("from") ?? 0
            let hi = node.double("through") ?? 1
            let v = node.double("value") ?? 0
            ProgressView(value: max(0, min(1, hi > lo ? (v - lo) / (hi - lo) : 0)))
        case "DatePicker":
            // Read-only in widgets: the formatted date.
            Text(
                Date(timeIntervalSince1970: (node.double("value") ?? 0) / 1000),
                style: .date)
        case "Map":
            // Maps aren't supported in widget timelines; show a placeholder.
            Image(systemName: "map")
        case "TextField":
            Text(node.string("value") ?? node.string("placeholder") ?? "")
        case "Picker":
            Text(pickerSummary(node))
        default:
            EmptyView()
        }
    }

    private func children(_ node: RNNode) -> some View {
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
        // monospacedDigit had drifted out of the widget interpreter (CX-018).
        if node.bool("monospacedDigit") == true { text = text.monospacedDigit() }
        if let style = node.string("textStyle") {
            text = text.font(semanticFont(style))
        } else if let size = node.double("size") {
            text = text.font(.system(size: CGFloat(size)))
        }
        return text.foregroundStyle(color(node.string("color")) ?? .primary)
    }

    private func semanticFont(_ style: String) -> Font {
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

    /// Auto-updating timer label; valid in widgets (Text(timerInterval:) is
    /// one of the few views WidgetKit ticks without a timeline reload).
    @ViewBuilder private func timerText(_ node: RNNode) -> some View {
        if let until = node.double("until") {
            let end = Date(timeIntervalSince1970: until / 1000)
            styled(
                node,
                Text(
                    timerInterval: Date()...Swift.max(Date(), end),
                    countsDown: true))
        } else {
            let start = Date(timeIntervalSince1970: (node.double("since") ?? 0) / 1000)
            styled(
                node,
                Text(
                    timerInterval: start...Date.distantFuture,
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
        RNStyle.formatValue(value)
    }

    private func cgFloat(_ node: RNNode, _ key: String) -> CGFloat? {
        node.double(key).map { CGFloat($0) }
    }

    /// Shares color parsing (named set + #RRGGBB/#RRGGBBAA hex) with the app
    /// interpreter via RNStyle, so the widget no longer silently lacks hex
    /// colors (CX-018). Only the name -> SwiftUI.Color mapping stays local.
    private func color(_ name: String?) -> Color? {
        guard let value = RNStyle.color(name) else { return nil }
        switch value {
        case .named(let named): return Self.systemColor(named)
        case .rgba(let r, let g, let b, let a):
            return Color(red: r, green: g, blue: b, opacity: a)
        }
    }

    private static func systemColor(_ name: String) -> Color {
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
        default: .primary
        }
    }
}
