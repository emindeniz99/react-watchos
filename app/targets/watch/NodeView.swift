import SwiftUI

/// Interprets the serialized React tree as SwiftUI views. One case per
/// primitive in js/src/components.ts.
struct NodeView: View {
    let node: RNNode
    @EnvironmentObject private var model: ReactAppModel

    var body: some View {
        switch node.type {
        case "VStack":
            VStack(spacing: cgFloat("spacing")) { childViews }
        case "HStack":
            HStack(spacing: cgFloat("spacing")) { childViews }
        case "Text":
            styledText
        case "Button":
            Button(action: { model.dispatch(nodeId: node.id, event: "press") }) {
                childViews
            }
        case "Toggle":
            Toggle(isOn: toggleBinding) { Text(node.string("label") ?? "") }
        case "Spacer":
            Spacer(minLength: 0)
        case "Image":
            Image(systemName: node.string("systemName") ?? "questionmark")
                .font(.system(size: CGFloat(node.double("size") ?? 17)))
                .foregroundStyle(color(node.string("color")) ?? .primary)
        case "ZStack":
            ZStack { childViews }
        case "ScrollView":
            ScrollView { childViews }
        case "List":
            List { childViews }
        case "Divider":
            Divider()
        case "Gauge":
            gauge
        case "ProgressView":
            if let value = node.double("value") {
                ProgressView(
                    value: value, total: node.double("total") ?? 1
                ) { Text(node.string("label") ?? "") }
            } else {
                ProgressView()
            }
        case "NavigationStack":
            NavigationStack {
                Group { childViews }
                    .navigationTitle(node.string("title") ?? "")
            }
        case "NavigationLink":
            NavigationLink(node.string("title") ?? "") {
                ScrollView { childViews }
            }
        default:
            // Unknown node type: skip it but keep rendering siblings, so a
            // newer JS bundle degrades gracefully on an older interpreter.
            EmptyView()
        }
    }

    @ViewBuilder private var childViews: some View {
        ForEach(node.children) { child in
            NodeView(node: child)
        }
    }

    private var styledText: some View {
        var text = Text(node.string("text") ?? "")
        if node.bool("bold") == true { text = text.bold() }
        if let size = node.double("size") {
            text = text.font(.system(size: CGFloat(size)))
        }
        return text.foregroundStyle(color(node.string("color")) ?? .primary)
    }

    @ViewBuilder private var gauge: some View {
        let min = node.double("min") ?? 0
        let max = node.double("max") ?? 1
        let value = Swift.min(Swift.max(node.double("value") ?? 0, min), max)
        let base = Gauge(value: value, in: min...max) {
            Text(node.string("label") ?? "")
        } currentValueLabel: {
            Text(formatted(value))
        }
        .tint(color(node.string("color")) ?? .accentColor)
        if node.string("style") == "circular" {
            base.gaugeStyle(.accessoryCircular)
        } else {
            base.gaugeStyle(.accessoryLinear)
        }
    }

    private func formatted(_ value: Double) -> String {
        value.truncatingRemainder(dividingBy: 1) == 0
            ? String(Int(value)) : String(format: "%.1f", value)
    }

    private var toggleBinding: Binding<Bool> {
        Binding(
            get: { node.bool("value") ?? false },
            set: { newValue in
                model.dispatch(
                    nodeId: node.id, event: "change",
                    payload: ["value": newValue])
            })
    }

    private func cgFloat(_ key: String) -> CGFloat? {
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
