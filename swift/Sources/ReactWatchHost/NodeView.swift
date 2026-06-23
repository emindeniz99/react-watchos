import MapKit
import ReactWatchCore
import SwiftUI
import UIKit

/// Interprets the serialized React tree as SwiftUI views. One case per
/// primitive in js/src/components.ts.
struct NodeView: View {
    let node: RNNode
    @EnvironmentObject private var model: ReactWatchModel
    /// Min height for the wheel Picker, scaled with the user's text size so a
    /// large Dynamic Type setting doesn't re-clip the selected row.
    @ScaledMetric private var pickerMinHeight: CGFloat = 90

    var body: some View {
        rendered
            .modifier(GlassModifier(glass: node.bool("glass") == true))
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
            buttonView
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
            // watchOS renders a default Picker as a wheel; inside a VStack it
            // collapses to a single clipped row. Give it room so the selected
            // value (and its neighbors) read fully.
            .frame(minHeight: pickerMinHeight)
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
        case "Map":
            mapView
        default:
            // Unknown node type: skip it but keep rendering siblings, so a
            // newer JS bundle degrades gracefully on an older interpreter.
            EmptyView()
        }
    }

    // A Button, optionally bound to the double-tap gesture (watchOS 11+).
    @ViewBuilder private var buttonView: some View {
        let button = Button(
            action: { model.dispatch(nodeId: node.id, event: "press") }
        ) { childViews }
        if node.bool("primaryAction") == true, #available(watchOS 11.0, *) {
            button.handGestureShortcut(.primaryAction)
        } else {
            button
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
        if node.bool("monospacedDigit") == true { text = text.monospacedDigit() }
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
        if node.bool("milliseconds") == true {
            let untilMs = node.double("until")
            let sinceMs = node.double("since") ?? 0
            TimelineView(.periodic(from: .now, by: 0.05)) { context in
                let interval = timerInterval(
                    at: context.date, sinceMs: sinceMs, untilMs: untilMs)
                styledTimer(Text(formatTimer(interval)))
            }
        } else if let until = node.double("until") {
            let end = Date(timeIntervalSince1970: until / 1000)
            styledTimer(Text(timerInterval: Date()...Swift.max(Date(), end),
                             countsDown: true))
        } else {
            let start = Date(timeIntervalSince1970: (node.double("since") ?? 0) / 1000)
            styledTimer(Text(timerInterval: start...Date.distantFuture,
                             countsDown: false))
        }
    }

    private func styledTimer(_ base: Text) -> some View {
        styled(base.monospacedDigit())
    }

    private func timerInterval(
        at now: Date, sinceMs: Double, untilMs: Double?
    ) -> TimeInterval {
        if let untilMs {
            let end = Date(timeIntervalSince1970: untilMs / 1000)
            return Swift.max(0, end.timeIntervalSince(now))
        }
        let start = Date(timeIntervalSince1970: sinceMs / 1000)
        return Swift.max(0, now.timeIntervalSince(start))
    }

    private func formatTimer(_ interval: TimeInterval) -> String {
        let totalMs = Int((interval * 1000).rounded(.down))
        let minutes = totalMs / 60_000
        let seconds = (totalMs / 1000) % 60
        let millis = totalMs % 1000
        return String(format: "%02d:%02d.%03d", minutes, seconds, millis)
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

    // MapKit map with markers + an optional polyline route. Annotations and
    // route are nested JSONValue arrays-of-objects in the wire tree.
    @ViewBuilder private var mapView: some View {
        let annotations = coordinates(node.props["annotations"])
        let route = coordinates(node.props["route"]).map(\.coordinate)
        Map {
            ForEach(Array(annotations.enumerated()), id: \.offset) { _, a in
                Marker(a.title ?? "", systemImage: a.systemImage ?? "mappin",
                       coordinate: a.coordinate)
                    .tint(color(a.tint) ?? .red)
            }
            if route.count > 1 {
                MapPolyline(coordinates: route).stroke(.blue, lineWidth: 3)
            }
        }
        .frame(height: cgFloat("height") ?? 120)
    }

    private struct MapPoint {
        let coordinate: CLLocationCoordinate2D
        let title: String?
        let systemImage: String?
        let tint: String?
    }

    private func coordinates(_ value: JSONValue?) -> [MapPoint] {
        guard case .array(let items)? = value else { return [] }
        return items.compactMap { item in
            guard case .object(let dict) = item,
                  case .number(let lat)? = dict["lat"],
                  case .number(let lon)? = dict["lon"] else { return nil }
            func str(_ k: String) -> String? {
                if case .string(let s)? = dict[k] { return s }
                return nil
            }
            return MapPoint(
                coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lon),
                title: str("title"), systemImage: str("systemImage"),
                tint: str("tint"))
        }
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
    @EnvironmentObject private var model: ReactWatchModel
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
    @EnvironmentObject private var model: ReactWatchModel

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
    let model: ReactWatchModel
    // Last quantized drag point dispatched, to throttle onDrag streaming.
    @State private var lastDrag: CGPoint?

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
        let drags = node.bool("onSwipe") == true || node.bool("onDrag") == true
        if longPress, drags {
            content.onLongPressGesture { dispatchLongPress() }
                .gesture(dragGesture)
        } else if longPress {
            content.onLongPressGesture { dispatchLongPress() }
        } else if drags {
            content.gesture(dragGesture)
        } else {
            content
        }
    }

    private func dispatchLongPress() {
        model.dispatch(nodeId: node.id, event: "longPress")
    }

    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: node.bool("onDrag") == true ? 0 : 20)
            .onChanged { value in
                guard node.bool("onDrag") == true else { return }
                // Quantize to 4pt steps so streaming doesn't flood the bridge.
                let qx = (value.translation.width / 4).rounded() * 4
                let qy = (value.translation.height / 4).rounded() * 4
                let point = CGPoint(x: qx, y: qy)
                if point != lastDrag {
                    lastDrag = point
                    model.dispatch(
                        nodeId: node.id, event: "drag",
                        payload: ["x": qx, "y": qy])
                }
            }
            .onEnded { value in
                lastDrag = nil
                guard node.bool("onSwipe") == true else { return }
                let dx = value.translation.width
                let dy = value.translation.height
                let direction = abs(dx) > abs(dy)
                    ? (dx < 0 ? "left" : "right")
                    : (dy < 0 ? "up" : "down")
                model.dispatch(
                    nodeId: node.id, event: "swipe",
                    payload: ["direction": direction])
            }
    }
}

/// Applies the watchOS 26 Liquid Glass effect when opted in; a no-op on
/// older OSes so the same JS runs everywhere.
private struct GlassModifier: ViewModifier {
    let glass: Bool

    @ViewBuilder func body(content: Content) -> some View {
        if glass, #available(watchOS 26.0, *) {
            content.glassEffect()
        } else {
            content
        }
    }
}
