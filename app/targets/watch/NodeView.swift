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
            styled(Text(node.string("text") ?? ""))
        case "TimerText":
            timerText
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
                destinationView
            }
        case "TextField":
            OptimisticTextField(node: node)
        case "Picker":
            Picker(node.string("label") ?? "", selection: pickerBinding) {
                let options = node.stringArray("options") ?? []
                ForEach(0..<options.count, id: \.self) { index in
                    Text(options[index]).tag(index)
                }
            }
        case "TabView":
            TabView { childViews }
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

    private func styled(_ base: Text) -> some View {
        var text = base
        if node.bool("bold") == true { text = text.bold() }
        if let size = node.double("size") {
            text = text.font(.system(size: CGFloat(size)))
        }
        return text.foregroundStyle(color(node.string("color")) ?? .primary)
    }

    // Self-ticking label: SwiftUI updates the digits natively (no per-frame
    // JS). `until` counts down to a deadline; otherwise count up from `since`.
    @ViewBuilder private var timerText: some View {
        if let until = node.double("until") {
            let end = Date(timeIntervalSince1970: until / 1000)
            styled(Text(timerInterval: Date()...Swift.max(Date(), end),
                        countsDown: true))
        } else {
            let start = Date(timeIntervalSince1970: (node.double("since") ?? 0) / 1000)
            styled(Text(timerInterval: start...Date.distantFuture,
                        countsDown: false))
        }
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

    // Optimistic bindings: the change event round-trips through QuickJS
    // before the new tree commits. The model holds the local value (keyed
    // by node id, surviving view identity changes) and releases it only
    // when React acks this control's latest dispatch — releasing on value
    // change alone snaps back under rapid interaction and never releases
    // for no-op handlers.
    private var toggleBinding: Binding<Bool> {
        Binding(
            get: { model.optimisticBool(node.id) ?? node.bool("value") ?? false },
            set: { newValue in
                model.dispatchOptimistic(
                    nodeId: node.id, value: .bool(newValue),
                    payload: ["value": newValue])
            })
    }

    private var pickerBinding: Binding<Int> {
        Binding(
            get: {
                model.optimisticInt(node.id) ?? Int(node.double("value") ?? 0)
            },
            set: { newValue in
                model.dispatchOptimistic(
                    nodeId: node.id, value: .number(Double(newValue)),
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

/// watchOS text input is modal (dictation/scribble/QWERTY); the value
/// dispatches to React on commit, with a local copy while editing.
private struct OptimisticTextField: View {
    let node: RNNode
    @EnvironmentObject private var model: ReactAppModel
    @State private var text: String = ""
    @State private var seeded = false

    var body: some View {
        TextField(node.string("placeholder") ?? "", text: $text)
            .onAppear {
                if !seeded {
                    text = node.string("value") ?? ""
                    seeded = true
                }
            }
            .onChange(of: node.string("value")) { _, newValue in
                text = newValue ?? ""
            }
            .onSubmit {
                model.dispatch(
                    nodeId: node.id, event: "change",
                    payload: ["value": text])
            }
    }
}

