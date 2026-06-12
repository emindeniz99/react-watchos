import SwiftUI

/// Non-interactive interpreter for React-rendered widget trees. Same node
/// vocabulary as the watch app's NodeView, minus events (WidgetKit views
/// are static) and navigation. nil renders the placeholder.
struct WidgetNodeView: View {
    let node: RNNode?

    var body: some View {
        if let node {
            render(node)
        } else {
            // Placeholder/redacted state before the app publishes data.
            Image(systemName: "drop")
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
            styledText(node)
        case "Image":
            Image(systemName: node.string("systemName") ?? "questionmark")
                .font(.system(size: CGFloat(node.double("size") ?? 17)))
                .foregroundStyle(color(node.string("color")) ?? .primary)
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
             "List", "TabView":
            children(node)
        case "Toggle":
            Text(node.string("label") ?? "")
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

    private func styledText(_ node: RNNode) -> some View {
        var text = Text(node.string("text") ?? "")
        if node.bool("bold") == true { text = text.bold() }
        if let size = node.double("size") {
            text = text.font(.system(size: CGFloat(size)))
        }
        return text.foregroundStyle(color(node.string("color")) ?? .primary)
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
