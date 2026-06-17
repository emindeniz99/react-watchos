import SwiftUI
import UIKit

/// Interprets the serialized React tree as SwiftUI views. One case per
/// primitive in js/src/components.ts.
struct NodeView: View {
    let node: RNNode
    @EnvironmentObject private var model: ReactAppModel

    var body: some View {
        rendered
            .modifier(A11yModifier(
                label: node.string("accessibilityLabel"),
                hint: node.string("accessibilityHint")))
            .modifier(GestureModifier(node: node, model: model))
    }

    @ViewBuilder private var rendered: some View {
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
            imageView
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
        case "CrownRotation":
            CrownRotationView(node: node)
        case "Slider":
            let lo = node.double("from") ?? 0
            let hi = node.double("through") ?? 1
            if let step = node.double("step") {
                Slider(value: doubleBinding, in: lo...hi, step: step)
            } else {
                Slider(value: doubleBinding, in: lo...hi)
            }
        case "Stepper":
            Stepper(
                value: doubleBinding,
                in: (node.double("from") ?? 0)...(node.double("through") ?? 100),
                step: node.double("step") ?? 1
            ) { Text(node.string("label") ?? "") }
        case "DatePicker":
            DatePicker(
                node.string("label") ?? "",
                selection: dateBinding,
                displayedComponents: dateComponents(node.string("mode")))
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

    // Three image sources: base64 inline bitmap, remote URL (AsyncImage,
    // native-loaded + cached), or an SF Symbol. Symbols for icons, URLs for
    // photos/posters, base64 only for small inline bitmaps.
    @ViewBuilder private var imageView: some View {
        let side = cgFloat("size")
        if let b64 = node.string("data"),
           let data = Data(base64Encoded: b64),
           let ui = UIImage(data: data) {
            Image(uiImage: ui).resizable().scaledToFit()
                .frame(width: side, height: side)
        } else if let urlString = node.string("source"),
                  let url = URL(string: urlString) {
            AsyncImage(url: url) { image in
                image.resizable().scaledToFit()
            } placeholder: {
                ProgressView()
            }
            .frame(width: side, height: side)
        } else {
            Image(systemName: node.string("systemName") ?? "questionmark")
                .font(.system(size: CGFloat(node.double("size") ?? 17)))
                .foregroundStyle(color(node.string("color")) ?? .primary)
        }
    }

    private func styled(_ base: Text) -> some View {
        var text = base
        if node.bool("bold") == true { text = text.bold() }
        // Semantic textStyle scales with Dynamic Type; fixed size doesn't.
        if let style = node.string("textStyle") {
            text = text.font(semanticFont(style))
        } else if let size = node.double("size") {
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

    private func dateComponents(_ mode: String?) -> DatePickerComponents {
        switch mode {
        case "date": [.date]
        case "hourAndMinute": [.hourAndMinute]
        default: [.date, .hourAndMinute]
        }
    }

    /// Optimistic Date binding: value/onChange cross the bridge as epoch ms.
    private var dateBinding: Binding<Date> {
        Binding(
            get: {
                let ms = model.optimisticDouble(node.id) ?? (node.double("value") ?? 0)
                return Date(timeIntervalSince1970: ms / 1000)
            },
            set: { newDate in
                let ms = newDate.timeIntervalSince1970 * 1000
                model.dispatchOptimistic(
                    nodeId: node.id, value: .number(ms), payload: ["value": ms])
            })
    }

    /// Optimistic Double binding shared by Slider and Stepper.
    private var doubleBinding: Binding<Double> {
        Binding(
            get: {
                model.optimisticDouble(node.id) ?? (node.double("value") ?? 0)
            },
            set: { newValue in
                model.dispatchOptimistic(
                    nodeId: node.id, value: .number(newValue),
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


/// Applies optional VoiceOver metadata to any node (A11yProps in
/// js/src/components.ts). Only set when present so unlabeled nodes keep
/// SwiftUI's inferred accessibility.
private struct A11yModifier: ViewModifier {
    let label: String?
    let hint: String?

    @ViewBuilder func body(content: Content) -> some View {
        switch (label, hint) {
        case let (label?, hint?):
            content.accessibilityLabel(label).accessibilityHint(hint)
        case let (label?, nil):
            content.accessibilityLabel(label)
        case let (nil, hint?):
            content.accessibilityHint(hint)
        case (nil, nil):
            content
        }
    }
}

/// Binds the Digital Crown to a numeric value over its children. The
/// optimistic value (model-keyed) holds the displayed number until React
/// acks the change, like the other input controls.
private struct CrownRotationView: View {
    let node: RNNode
    @EnvironmentObject private var model: ReactAppModel

    var body: some View {
        VStack { ForEach(node.children) { NodeView(node: $0) } }
            .focusable()
            .digitalCrownRotation(
                binding,
                from: node.double("from") ?? 0,
                through: node.double("through") ?? 100,
                by: node.double("step") ?? 1,
                sensitivity: .medium,
                isContinuous: false,
                isHapticFeedbackEnabled: node.bool("haptic") ?? true)
    }

    private var binding: Binding<Double> {
        Binding(
            get: {
                model.optimisticDouble(node.id) ?? (node.double("value") ?? 0)
            },
            set: { newValue in
                model.dispatchOptimistic(
                    nodeId: node.id, value: .number(newValue),
                    payload: ["value": newValue])
            })
    }
}

/// Applies opt-in gestures (GestureProps in js/src/components.ts) to any
/// node. Only attaches a gesture when its flag is present, so unmarked
/// nodes are untouched.
private struct GestureModifier: ViewModifier {
    let node: RNNode
    let model: ReactAppModel

    @ViewBuilder func body(content: Content) -> some View {
        // Only opt into focus when asked — applying .focusable(false) would
        // break the default Crown focusability of Slider/Picker/etc.
        if node.bool("focusable") == true {
            gestured(content).focusable()
        } else {
            gestured(content)
        }
    }

    @ViewBuilder private func gestured(_ content: Content) -> some View {
        let longPress = node.bool("onLongPress") == true
        let swipe = node.bool("onSwipe") == true
        if longPress, swipe {
            content.onLongPressGesture { dispatchLongPress() }
                .gesture(swipeGesture)
        } else if longPress {
            content.onLongPressGesture { dispatchLongPress() }
        } else if swipe {
            content.gesture(swipeGesture)
        } else {
            content
        }
    }

    private func dispatchLongPress() {
        model.dispatch(nodeId: node.id, event: "longPress")
    }

    private var swipeGesture: some Gesture {
        DragGesture(minimumDistance: 20).onEnded { value in
            let dx = value.translation.width
            let dy = value.translation.height
            let direction: String
            if abs(dx) > abs(dy) {
                direction = dx < 0 ? "left" : "right"
            } else {
                direction = dy < 0 ? "up" : "down"
            }
            model.dispatch(
                nodeId: node.id, event: "swipe",
                payload: ["direction": direction])
        }
    }
}
