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
            OptimisticToggle(node: node)
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
                destinationView
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

    /// Destinations get a ScrollView unless they already scroll themselves
    /// (nesting scroll containers breaks watchOS scrolling).
    @ViewBuilder private var destinationView: some View {
        if node.children.count == 1,
           ["ScrollView", "List", "TabView", "NavigationStack"]
               .contains(node.children[0].type) {
            NodeView(node: node.children[0])
        } else {
            ScrollView { childViews }
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

/// The change event round-trips through QuickJS before the new tree
/// commits; a local override keeps the switch from visually snapping
/// back in the meantime, and clears once React confirms the value.
private struct OptimisticToggle: View {
    let node: RNNode
    @EnvironmentObject private var model: ReactAppModel
    @State private var localValue: Bool?

    var body: some View {
        Toggle(isOn: binding) { Text(node.string("label") ?? "") }
            .onChange(of: node.bool("value")) { _, _ in localValue = nil }
    }

    private var binding: Binding<Bool> {
        Binding(
            get: { localValue ?? node.bool("value") ?? false },
            set: { newValue in
                localValue = newValue
                model.dispatch(
                    nodeId: node.id, event: "change",
                    payload: ["value": newValue])
            })
    }
}
