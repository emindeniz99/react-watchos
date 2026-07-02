// watchOS-only host (WatchKit/UIKit/HealthKit/SwiftUI). The #if compiles this
// file to an empty module off-watchOS so `swift test` runs on macOS — see Package.swift.
#if os(watchOS)
import MapKit
import os
import ReactWatchCore
import ReactWatchSupport
import SwiftUI
import UIKit

/// Logs each unsupported node type once. The SwiftUI body re-renders, so logging
/// on every pass would flood; an unknown type means a newer JS bundle reached an
/// older interpreter. We still skip the node (degrade gracefully, keep rendering
/// siblings) but make it diagnosable instead of a silent no-op.
private let interpreterLog = Logger(
    subsystem: "com.emindeniz99.reactwatch", category: "interpreter")
private let loggedUnsupportedTypes = OSAllocatedUnfairLock(initialState: Set<String>())

private func unsupportedNode(_ type: String) -> some View {
    let isNew = loggedUnsupportedTypes.withLock { $0.insert(type).inserted }
    if isNew {
        interpreterLog.error(
            "tried to render unsupported node type '\(type, privacy: .public)' — skipped; rebuild the bundle or update the app"
        )
    }
    return EmptyView()
}

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
            // A controlled input with no `onChange` handler (serialize.ts emits
            // the prop as `true` when a handler exists) is read-only: disable it
            // so it can't show a local value React will never accept (CX-010).
            .disabled(isHandlerlessControl)
            .modifier(LayoutModifier(node: node))
            .modifier(GlassModifier(glass: node.bool("glass") == true))
            .modifier(
                A11yModifier(
                    label: node.string("accessibilityLabel"),
                    hint: node.string("accessibilityHint")
                )
            )
            .modifier(GestureModifier(node: node, model: model))
            .modifier(
                SwipeActionsModifier(
                    node: node, model: model,
                    trailingTint: color(node.string("swipeActionTint")),
                    leadingTint: color(node.string("leadingSwipeActionTint"))
                ))
    }

    /// A native input control whose change handler is absent. `.disabled(false)`
    /// on every other node is a SwiftUI no-op, so this is safe to apply in body.
    private var isHandlerlessControl: Bool {
        let controls: Set = [
            "Toggle", "Slider", "Stepper", "Picker", "DatePicker", "TextField",
            "CrownRotation",
        ]
        return controls.contains(node.type) && node.bool("onChange") != true
    }

    @ViewBuilder private var rendered: some View {
        switch node.type {
        case "VStack":
            VStack(
                alignment: Self.horizontalAlignment(node.string("alignment")),
                spacing: cgFloat("spacing")
            ) { childViews }
        case "HStack":
            HStack(
                alignment: Self.verticalAlignment(node.string("alignment")),
                spacing: cgFloat("spacing")
            ) { childViews }
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
            ZStack(alignment: Self.zAlignment(node.string("alignment"))) {
                childViews
            }
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
            RoutedNavigationStack(node: node)
        case "NavigationLink":
            navigationLink
        case "NavigationRoute":
            NavigationRouteDestination(node: node)
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
                displayedComponents: dateComponents(node.string("mode"))
            )
        case "Map":
            mapView
        default:
            // Unknown node type: skip it but keep rendering siblings, so a
            // newer JS bundle degrades gracefully on an older interpreter — and
            // log it (once per type) so the skip isn't silent.
            unsupportedNode(node.type)
        }
    }

    /// A Button, optionally bound to the double-tap gesture (watchOS 11+).
    @ViewBuilder private var buttonView: some View {
        let button = Button(
            action: { model.dispatch(nodeId: node.id, event: "press") }
        ) { childViews }
        if node.bool("primaryAction") == true, #available(watchOS 11.0, *) {
            accessibleButton(button).handGestureShortcut(.primaryAction)
        } else {
            accessibleButton(button)
        }
    }

    private var buttonAccessibilityLabel: String? {
        if node.string("accessibilityLabel") != nil { return nil }
        let text = textContent(in: node)
        return text.isEmpty ? nil : text
    }

    @ViewBuilder private func accessibleButton(_ button: some View) -> some View {
        if let label = buttonAccessibilityLabel {
            button.accessibilityLabel(label)
        } else {
            button
        }
    }

    private func textContent(in node: RNNode) -> String {
        let own = node.type == "Text" ? node.string("text") ?? "" : ""
        let childText = node.children.map(textContent).filter { !$0.isEmpty }
            .joined(separator: " ")
        return [own, childText].filter { !$0.isEmpty }.joined(separator: " ")
    }

    private var childViews: some View {
        ForEach(node.children) { child in
            NodeView(node: child)
        }
    }

    @ViewBuilder private var navigationLink: some View {
        if let to = node.string("to") {
            NavigationLink(value: to) {
                navigationLinkLabel
            }
        } else {
            navigationLinkLabel
        }
    }

    @ViewBuilder private var navigationLinkLabel: some View {
        if let label = node.string("label") {
            Text(label)
        } else if node.children.isEmpty {
            Text(node.string("to") ?? "")
        } else {
            childViews
        }
    }

    /// Three image sources: base64 inline bitmap, remote URL (AsyncImage,
    /// native-loaded + cached), or an SF Symbol. Symbols for icons, URLs for
    /// photos/posters, base64 only for small inline bitmaps.
    @ViewBuilder private var imageView: some View {
        let side = cgFloat("size")
        if let b64 = node.string("data"),
            let data = Data(base64Encoded: b64),
            let ui = UIImage(data: data)
        {
            Image(uiImage: ui).resizable().scaledToFit()
                .frame(width: side, height: side)
        } else if let urlString = node.string("source"),
            let url = URL(string: urlString)
        {
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

    /// Self-ticking label: SwiftUI updates the digits natively (no per-frame
    /// JS). `until` counts down to a deadline; otherwise count up from `since`.
    @ViewBuilder private var timerText: some View {
        if node.bool("milliseconds") == true {
            let untilMs = node.double("until")
            let sinceMs = node.double("since") ?? 0
            TimelineView(.periodic(from: .now, by: 0.05)) { context in
                let interval = timerInterval(
                    at: context.date, sinceMs: sinceMs, untilMs: untilMs
                )
                styledTimer(Text(formatTimer(interval)))
            }
        } else if let until = node.double("until") {
            let end = Date(timeIntervalSince1970: until / 1000)
            styledTimer(
                Text(
                    timerInterval: Date()...Swift.max(Date(), end),
                    countsDown: true))
        } else {
            let start = Date(timeIntervalSince1970: (node.double("since") ?? 0) / 1000)
            styledTimer(
                Text(
                    timerInterval: start...Date.distantFuture,
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
        RNStyle.formatTimer(interval)
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
        RNStyle.formatValue(value)
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

    /// Optimistic bindings: the change event round-trips through QuickJS
    /// before the new tree commits. The model holds the local value (keyed
    /// by node id, surviving view identity changes) and releases it only
    /// when React acks this control's latest dispatch — releasing on value
    /// change alone snaps back under rapid interaction and never releases
    /// for no-op handlers.
    private var toggleBinding: Binding<Bool> {
        Binding(
            get: { model.optimisticBool(node.id) ?? node.bool("value") ?? false },
            set: { newValue in
                model.dispatchOptimistic(
                    nodeId: node.id, value: .bool(newValue),
                    payload: ["value": newValue]
                )
            }
        )
    }

    /// MapKit map with markers + an optional polyline route. Annotations and
    /// route are nested JSONValue arrays-of-objects in the wire tree.
    @ViewBuilder private var mapView: some View {
        let annotations = coordinates(node.props["annotations"])
        let route = coordinates(node.props["route"]).map(\.coordinate)
        Map(initialPosition: mapPosition) {
            ForEach(annotations) { a in
                Marker(
                    a.title ?? "", systemImage: a.systemImage ?? "mappin",
                    coordinate: a.coordinate
                )
                .tint(color(a.tint) ?? .red)
            }
            if route.count > 1 {
                MapPolyline(coordinates: route).stroke(.blue, lineWidth: 3)
            }
        }
        .frame(height: cgFloat("height") ?? 120)
    }

    /// Region from the `latitude`/`longitude`/`span` props (CX-015) — these were
    /// public but ignored. When absent, `.automatic` fits the annotations/route.
    private var mapPosition: MapCameraPosition {
        guard let lat = node.double("latitude"),
            let lon = node.double("longitude")
        else { return .automatic }
        let span = node.double("span") ?? 0.02
        return .region(
            MKCoordinateRegion(
                center: CLLocationCoordinate2D(latitude: lat, longitude: lon),
                span: MKCoordinateSpan(latitudeDelta: span, longitudeDelta: span)
            ))
    }

    private struct MapPoint: Identifiable {
        let coordinate: CLLocationCoordinate2D
        let title: String?
        let systemImage: String?
        let tint: String?
        /// Stable across reorders (OP-6): identity is the marker's place + label,
        /// not its array position, so SwiftUI doesn't re-drop every pin on change.
        var id: String {
            "\(coordinate.latitude),\(coordinate.longitude):\(title ?? "")"
        }
    }

    private func coordinates(_ value: JSONValue?) -> [MapPoint] {
        guard case .array(let items)? = value else { return [] }
        return items.compactMap { item in
            guard case .object(let dict) = item,
                case .number(let lat)? = dict["lat"],
                case .number(let lon)? = dict["lon"]
            else { return nil }
            func str(_ k: String) -> String? {
                if case .string(let s)? = dict[k] { return s }
                return nil
            }
            return MapPoint(
                coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lon),
                title: str("title"), systemImage: str("systemImage"),
                tint: str("tint")
            )
        }
    }

    private func dateComponents(_ mode: String?) -> DatePickerComponents {
        switch mode {
        case "date": return [.date]
        case "hourAndMinute": return [.hourAndMinute]
        case "dateAndTime", nil: return [.date, .hourAndMinute]
        default:
            // The contract is date / hourAndMinute / dateAndTime; an unknown
            // value is a typo from dynamic JS. Fall back to date+time, but make
            // it loud in DEBUG rather than silently swallowing the mistake.
            assertionFailure("unknown DatePicker mode \"\(mode ?? "")\"")
            return [.date, .hourAndMinute]
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
                    nodeId: node.id, value: .number(ms), payload: ["value": ms]
                )
            }
        )
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
                    payload: ["value": newValue]
                )
            }
        )
    }

    private var pickerBinding: Binding<Int> {
        Binding(
            get: {
                model.optimisticInt(node.id) ?? Int(node.double("value") ?? 0)
            },
            set: { newValue in
                model.dispatchOptimistic(
                    nodeId: node.id, value: .number(Double(newValue)),
                    payload: ["value": newValue]
                )
            }
        )
    }

    private func cgFloat(_ key: String) -> CGFloat? {
        node.double(key).map { CGFloat($0) }
    }

    /// Color parsing (named set + #RRGGBB/#RRGGBBAA hex) is shared with the
    /// widget interpreter via RNStyle so the two can't drift (CX-018); this only
    /// maps the parsed value to SwiftUI.
    private func color(_ name: String?) -> Color? {
        Self.styleColor(name)
    }

    /// Static so LayoutModifier (a separate ViewModifier) shares it.
    static func styleColor(_ name: String?) -> Color? {
        guard let value = RNStyle.color(name) else { return nil }
        switch value {
        case .named(let named): return Self.systemColor(named)
        case .rgba(let r, let g, let b, let a):
            return Color(red: r, green: g, blue: b, opacity: a)
        }
    }

    static func horizontalAlignment(_ name: String?) -> HorizontalAlignment {
        switch name {
        case "leading": .leading
        case "trailing": .trailing
        default: .center
        }
    }

    static func verticalAlignment(_ name: String?) -> VerticalAlignment {
        switch name {
        case "top": .top
        case "bottom": .bottom
        case "firstTextBaseline": .firstTextBaseline
        default: .center
        }
    }

    static func zAlignment(_ name: String?) -> Alignment {
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

    /// Maps a known RNStyle.namedColors name to its SwiftUI color.
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

private let navigationDestinationRootTypes: Set<String> = [
    "ScrollView", "List", "TabView", "NavigationStack",
]

private struct RoutedNavigationStack: View {
    let node: RNNode
    @EnvironmentObject private var model: ReactWatchModel
    @State private var localPath: [String] = []
    @State private var pendingPath: [String]?

    var body: some View {
        NavigationStack(path: pathBinding) {
            Group {
                ForEach(rootChildren) { child in
                    NodeView(node: child)
                }
            }
            .navigationTitle(rootTitle)
            .navigationDestination(for: String.self) { route in
                if let destination = routeNode(route) {
                    NavigationRouteDestination(node: destination)
                } else {
                    MissingNavigationRoute(route: route)
                }
            }
        }
        .onChange(of: controlledPath ?? []) { _, _ in
            pendingPath = nil
        }
    }

    private var controlledPath: [String]? {
        guard node.props["path"] != nil else { return nil }
        return normalized(node.stringArray("path") ?? [])
    }

    private var pathBinding: Binding<[String]> {
        Binding(
            get: { pendingPath ?? controlledPath ?? localPath },
            set: { newPath in
                let path = normalized(newPath)
                if controlledPath != nil {
                    pendingPath = path
                    model.dispatch(
                        nodeId: node.id, event: "pathChange",
                        payload: ["path": path]
                    )
                } else {
                    localPath = path
                }
            }
        )
    }

    private var routeNodes: [RNNode] {
        node.children.filter { $0.type == "NavigationRoute" }
    }

    private var rootRoute: RNNode? {
        routeNodes.first { normalized($0.string("path") ?? "/") == "/" }
    }

    private var rootChildren: [RNNode] {
        if let rootRoute { return rootRoute.children }
        return node.children.filter { $0.type != "NavigationRoute" }
    }

    private var rootTitle: String {
        rootRoute?.string("title") ?? node.string("title") ?? ""
    }

    private func routeNode(_ route: String) -> RNNode? {
        let path = normalized(route)
        if path == "/" { return nil }
        // Match Next.js/Expo-style patterns ([id], [...rest], [[...rest]]) and
        // render the most specific one — mirrors js/src/navigation matchRoute.
        var best: (node: RNNode, score: Int)?
        for candidate in routeNodes {
            let pattern = normalized(candidate.string("path") ?? "")
            if pattern == "/" { continue }
            guard let match = RouteMatcher.match(pattern: pattern, route: path)
            else { continue }
            if best == nil || match.score > best!.score {
                best = (candidate, match.score)
            }
        }
        return best?.node
    }

    private func normalized(_ path: [String]) -> [String] {
        path.map(normalized).filter { $0 != "/" }
    }

    private func normalized(_ route: String) -> String {
        if route.isEmpty || route == "/" { return "/" }
        return route.hasPrefix("/") ? route : "/\(route)"
    }
}

private struct NavigationRouteDestination: View {
    let node: RNNode

    var body: some View {
        content.navigationTitle(node.string("title") ?? "")
    }

    @ViewBuilder private var content: some View {
        if let only = node.children.first,
            node.children.count == 1,
            navigationDestinationRootTypes.contains(only.type)
        {
            NodeView(node: only)
        } else {
            ScrollView {
                ForEach(node.children) { child in
                    NodeView(node: child)
                }
            }
        }
    }
}

private struct MissingNavigationRoute: View {
    let route: String

    var body: some View {
        Text("Missing route: \(route)")
            .font(.footnote)
            .foregroundStyle(.red)
    }
}

/// watchOS text input is modal (dictation/scribble/QWERTY); the value
/// dispatches to React on commit, with a local copy while editing.
/// Controlled text field, the way React Native's TextInput is controlled: the
/// displayed value is the model-keyed optimistic edit (`optimisticString`)
/// falling back to the committed `value` prop — never view-local `@State`. So
/// the in-flight text is keyed by node id and survives a SwiftUI view-identity
/// change mid-edit (e.g. a List reorder), exactly like Toggle / Slider /
/// Stepper. watchOS text entry is modal (the system takes over full-screen for
/// dictation / Scribble / QWERTY and hands back one string), so the binding
/// commits once when the input UI closes: that single `set` records the
/// optimistic value and dispatches "change" — matching the
/// `TextFieldProps.onChange` "fires on commit" contract — and the entry clears
/// when React acks the commit.
private struct OptimisticTextField: View {
    let node: RNNode
    @EnvironmentObject private var model: ReactWatchModel

    private var textBinding: Binding<String> {
        Binding(
            get: { model.optimisticString(node.id) ?? node.string("value") ?? "" },
            set: { newValue in
                model.dispatchOptimistic(
                    nodeId: node.id, value: .string(newValue),
                    payload: ["value": newValue]
                )
            }
        )
    }

    var body: some View {
        TextField(node.string("placeholder") ?? "", text: textBinding)
    }
}

/// Applies optional VoiceOver metadata to any node (A11yProps in
/// js/src/components.ts). Only set when present so unlabeled nodes keep
/// SwiftUI's inferred accessibility.
private struct A11yModifier: ViewModifier {
    let label: String?
    let hint: String?

    func body(content: Content) -> some View {
        switch (label, hint) {
        case (let label?, let hint?):
            content.accessibilityLabel(label).accessibilityHint(hint)
        case (let label?, nil):
            content.accessibilityLabel(label)
        case (nil, let hint?):
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
                isHapticFeedbackEnabled: node.bool("haptic") ?? true
            )
    }

    private var binding: Binding<Double> {
        Binding(
            get: {
                model.optimisticDouble(node.id) ?? (node.double("value") ?? 0)
            },
            set: { newValue in
                model.dispatchOptimistic(
                    nodeId: node.id, value: .number(newValue),
                    payload: ["value": newValue]
                )
            }
        )
    }
}

/// Applies opt-in gestures (GestureProps in js/src/components.ts) to any
/// node. Only attaches a gesture when its flag is present, so unmarked
/// nodes are untouched.
private struct GestureModifier: ViewModifier {
    let node: RNNode
    let model: ReactWatchModel
    /// Last quantized drag point dispatched, to throttle onDrag streaming.
    @State private var lastDrag: CGPoint?

    func body(content: Content) -> some View {
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
                        payload: ["x": qx, "y": qy]
                    )
                }
            }
            .onEnded { value in
                lastDrag = nil
                guard node.bool("onSwipe") == true else { return }
                let dx = value.translation.width
                let dy = value.translation.height
                let direction =
                    abs(dx) > abs(dy)
                    ? (dx < 0 ? "left" : "right")
                    : (dy < 0 ? "up" : "down")
                model.dispatch(
                    nodeId: node.id, event: "swipe",
                    payload: ["direction": direction]
                )
            }
    }
}

/// Adds trailing (right-to-left) and/or leading (left-to-right) `.swipeActions`
/// buttons when the node opts in via `swipeActionLabel` /
/// `leadingSwipeActionLabel` — the watchOS-idiomatic row action (no-op unless
/// the view is a List row). Unlike the raw drag gesture it doesn't fight
/// scroll, and a full swipe triggers the action without tapping its button.
private struct SwipeActionsModifier: ViewModifier {
    let node: RNNode
    let model: ReactWatchModel
    let trailingTint: Color?
    let leadingTint: Color?

    func body(content: Content) -> some View {
        content
            .modifier(
                EdgeSwipeActionModifier(
                    node: node, model: model, edge: .trailing,
                    labelKey: "swipeActionLabel",
                    imageKey: "swipeActionSystemImage",
                    event: "swipeAction", tint: trailingTint
                )
            )
            .modifier(
                EdgeSwipeActionModifier(
                    node: node, model: model, edge: .leading,
                    labelKey: "leadingSwipeActionLabel",
                    imageKey: "leadingSwipeActionSystemImage",
                    event: "leadingSwipeAction", tint: leadingTint
                ))
    }
}

/// One `.swipeActions` edge; a no-op when its label prop is absent.
private struct EdgeSwipeActionModifier: ViewModifier {
    let node: RNNode
    let model: ReactWatchModel
    let edge: HorizontalEdge
    let labelKey: String
    let imageKey: String
    let event: String
    let tint: Color?

    func body(content: Content) -> some View {
        if let label = node.string(labelKey) {
            content.swipeActions(edge: edge, allowsFullSwipe: true) {
                Button {
                    model.dispatch(nodeId: node.id, event: event)
                } label: {
                    if let image = node.string(imageKey) {
                        Label(label, systemImage: image)
                    } else {
                        Text(label)
                    }
                }
                .tint(tint)
            }
        } else {
            content
        }
    }
}

/// Design-system Tier 1: the layout/appearance modifier props every visual
/// node supports (padding/frame/background/cornerRadius/opacity/tint).
/// Parsing is RNStyle (pure, Linux-tested, shared with the widget
/// interpreter); this only maps values to SwiftUI. Application order is the
/// documented contract in components.ts: padding -> background+cornerRadius
/// -> frame -> opacity -> tint.
struct LayoutModifier: ViewModifier {
    let node: RNNode

    func body(content: Content) -> some View {
        content
            .modifier(PaddingModifier(insets: RNStyle.padding(from: node.props["padding"])))
            .modifier(
                BackgroundModifier(
                    background: NodeView.styleColor(node.string("background")),
                    cornerRadius: node.double("cornerRadius").map { CGFloat($0) }
                )
            )
            .modifier(FrameModifier(frame: RNStyle.frame(from: node.props["frame"])))
            .opacity(node.double("opacity") ?? 1)
            .modifier(TintModifier(tint: NodeView.styleColor(node.string("tint"))))
    }
}

private struct PaddingModifier: ViewModifier {
    let insets: RNStyle.Insets?

    func body(content: Content) -> some View {
        if let all = insets?.all {
            content.padding(CGFloat(all))
        } else if let insets, insets.horizontal != nil || insets.vertical != nil {
            content
                .padding(.horizontal, insets.horizontal.map { CGFloat($0) } ?? 0)
                .padding(.vertical, insets.vertical.map { CGFloat($0) } ?? 0)
        } else {
            content
        }
    }
}

private struct BackgroundModifier: ViewModifier {
    let background: Color?
    let cornerRadius: CGFloat?

    func body(content: Content) -> some View {
        if let background, let cornerRadius {
            content.background(background, in: RoundedRectangle(cornerRadius: cornerRadius))
        } else if let background {
            content.background(background)
        } else if let cornerRadius {
            // No background: clip the content itself (e.g. a remote Image).
            content.clipShape(RoundedRectangle(cornerRadius: cornerRadius))
        } else {
            content
        }
    }
}

private struct FrameModifier: ViewModifier {
    let frame: RNStyle.Frame?

    func body(content: Content) -> some View {
        if let frame {
            content
                .frame(
                    width: frame.width.map { CGFloat($0) },
                    height: frame.height.map { CGFloat($0) }
                )
                .frame(
                    maxWidth: frame.maxWidthInfinity
                        ? .infinity : frame.maxWidth.map { CGFloat($0) },
                    maxHeight: frame.maxHeightInfinity
                        ? .infinity : frame.maxHeight.map { CGFloat($0) }
                )
        } else {
            content
        }
    }
}

private struct TintModifier: ViewModifier {
    let tint: Color?

    func body(content: Content) -> some View {
        if let tint { content.tint(tint) } else { content }
    }
}

/// Applies the watchOS 26 Liquid Glass effect when opted in; a no-op on
/// older OSes so the same JS runs everywhere.
private struct GlassModifier: ViewModifier {
    let glass: Bool

    func body(content: Content) -> some View {
        if glass, #available(watchOS 26.0, *) {
            content.glassEffect()
        } else {
            content
        }
    }
}
#endif
