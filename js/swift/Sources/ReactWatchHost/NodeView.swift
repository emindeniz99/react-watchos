// watchOS-only host (WatchKit/UIKit/HealthKit/SwiftUI). The #if compiles this
// file to an empty module off-watchOS so `swift test` runs on macOS — see Package.swift.
#if os(watchOS)
import Charts
import MapKit
import os
import ReactWatchCore
import ReactWatchSupport
import ReactWatchUI
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
                alignment: RNUI.horizontalAlignment(node.string("alignment")),
                spacing: cgFloat("spacing")
            ) { childViews }
        case "HStack":
            HStack(
                alignment: RNUI.verticalAlignment(node.string("alignment")),
                spacing: cgFloat("spacing")
            ) { childViews }
        case "Text":
            // Rich text: element children are styled segments concatenated
            // into ONE Text (scalar-only children folded into props.text).
            if node.children.isEmpty {
                styled(Text(node.string("text") ?? ""))
            } else {
                styled(
                    node.children.reduce(Text(node.string("text") ?? "")) {
                        $0 + RNUI.textSegment($1)
                    })
            }
        case "TimerText":
            timerText
        case "FormattedText":
            // Locale-aware date/number formatting, done natively (i18n step
            // 2). The mapping is the shared RNFormat kernel so the widget
            // interpreter can't drift.
            styled(Text(RNFormat.text(for: node)))
        case "Button":
            buttonView
        case "Toggle":
            Toggle(isOn: toggleBinding) { Text(node.string("label") ?? "") }
        case "Spacer":
            Spacer(minLength: 0)
        case "Image":
            imageView
        case "ZStack":
            ZStack(alignment: RNUI.zAlignment(node.string("alignment"))) {
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
        case "Alert":
            AlertNode(node: node, dialog: false)
        case "ConfirmationDialog":
            AlertNode(node: node, dialog: true)
        case "AlertAction":
            // Only meaningful as an Alert/ConfirmationDialog child, where the
            // parent renders it as a system button; standalone it is nothing.
            EmptyView()
        case "Sheet":
            SheetNode(node: node)
        case "Section":
            Section {
                childViews
            } header: {
                if let header = node.string("header") { Text(header) }
            } footer: {
                if let footer = node.string("footer") { Text(footer) }
            }
        case "Label":
            SwiftUI.Label(
                node.string("label") ?? "",
                systemImage: node.string("systemName") ?? "circle"
            )
            .foregroundStyle(color(node.string("color")) ?? .primary)
        case "Grid":
            Grid(
                horizontalSpacing: cgFloat("horizontalSpacing"),
                verticalSpacing: cgFloat("verticalSpacing")
            ) {
                ForEach(node.children.filter { $0.type == "GridRow" }) { row in
                    GridRow {
                        ForEach(row.children) { NodeView(node: $0) }
                    }
                    // The row node is expanded here rather than rendered through
                    // NodeView, so apply its a11y explicitly or it's dropped.
                    .modifier(
                        A11yModifier(
                            label: row.string("accessibilityLabel"),
                            hint: row.string("accessibilityHint")))
                }
            }
        case "GridRow":
            // Only meaningful as a direct <Grid> child (rendered there); a
            // stray row degrades to its cells side by side.
            HStack { childViews }
        case "ShareLink":
            shareLink
        case "Chart":
            chartView
        case "LabeledContent":
            LabeledContent(node.string("label") ?? "") {
                if node.children.isEmpty {
                    Text(node.string("value") ?? "")
                } else {
                    childViews
                }
            }
        case "ContentUnavailable":
            ContentUnavailableView {
                SwiftUI.Label(
                    node.string("title") ?? "",
                    systemImage: node.string("systemName") ?? "circle"
                )
            } description: {
                if let description = node.string("description") {
                    Text(description)
                }
            }
        case "Toolbar":
            ToolbarNode(node: node)
        case "ToolbarItem":
            // Only meaningful as a <Toolbar> child (rendered there).
            EmptyView()
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
            // Controlled ONLY when `selection` is present: an always-bound
            // default would snap an uncontrolled TabView back to page 0 on
            // the first ack (the optimistic value releases to the absent
            // prop).
            if node.double("selection") != nil {
                TabView(selection: tabSelectionBinding) {
                    ForEach(
                        Array(node.children.enumerated()), id: \.element.id
                    ) { index, child in
                        NodeView(node: child).tag(index)
                    }
                }
            } else {
                TabView { childViews }
            }
        case "CrownRotation":
            CrownRotationView(node: node)
        case "Slider":
            // Normalize bounds: a reversed from/through would trap building the
            // ClosedRange and crash the whole render, not just this node.
            let lo = node.double("from") ?? 0
            let hi = node.double("through") ?? 1
            let range = lo <= hi ? lo...hi : hi...lo
            if let step = node.double("step") {
                Slider(value: doubleBinding, in: range, step: step)
            } else {
                Slider(value: doubleBinding, in: range)
            }
        case "Stepper":
            let lo = node.double("from") ?? 0
            let hi = node.double("through") ?? 100
            Stepper(
                value: doubleBinding,
                in: lo <= hi ? lo...hi : hi...lo,
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
            glassStyled(accessibleButton(button)).handGestureShortcut(.primaryAction)
        } else {
            glassStyled(accessibleButton(button))
        }
    }

    /// Applies the `buttonStyle` prop. Liquid Glass (GlassButtonStyle, verified
    /// watchOS 26.0) is a no-op on older OSes; "plain" strips the default chrome
    /// so a custom-styled control (own background/frame) renders cleanly. The
    /// same JS runs everywhere.
    @ViewBuilder private func glassStyled(_ button: some View) -> some View {
        switch node.string("buttonStyle") {
        case "glass":
            if #available(watchOS 26.0, *) {
                button.buttonStyle(.glass)
            } else {
                button
            }
        case "glassProminent":
            if #available(watchOS 26.0, *) {
                button.buttonStyle(.glassProminent)
            } else {
                button
            }
        case "plain":
            button.buttonStyle(.plain)
        default:
            button
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
        RNUI.styled(node, base)
    }

    @ViewBuilder private var shareLink: some View {
        let item = node.string("item") ?? ""
        if node.children.isEmpty {
            ShareLink(item: item)
        } else {
            ShareLink(item: item) { childViews }
        }
    }

    /// Minimal Swift Charts binding: one mark type over one series. Points
    /// with string `x` chart as categories; numeric/absent `x` as positions.
    @ViewBuilder private var chartView: some View {
        let points = RNStyle.chartPoints(from: node.props["points"])
        let kind = node.string("type") ?? "line"
        let seriesColor = color(node.string("color")) ?? Color.accentColor
        Chart(Array(points.enumerated()), id: \.offset) { index, point in
            RNUI.chartMark(
                kind: kind, point: point, index: index, color: seriesColor)
        }
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
        // Bounds/value normalization is shared RNStyle.gaugeBounds so the app
        // and widget interpreters cannot drift on it (M4).
        let (min, max, value) = RNStyle.gaugeBounds(
            min: node.double("min"), max: node.double("max"),
            value: node.double("value"))
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

    /// MapKit map with markers + an optional polyline route. Rendered through
    /// `RNMapView`, which owns a controlled camera so JS can recenter/zoom the
    /// map by changing the `latitude`/`longitude`/`span` props (e.g. to fit new
    /// search results) — a one-shot `initialPosition` couldn't follow updates.
    /// The live user location (blue dot + smooth follow) is native — MapKit's
    /// `UserAnnotation` + `.userLocation` camera — not a JS-streamed marker.
    @ViewBuilder private var mapView: some View {
        let pins = coordinates(node.props["annotations"]).map { p in
            RNMapView.Pin(
                id: p.id, coordinate: p.coordinate, title: p.title ?? "",
                systemImage: p.systemImage ?? "mappin", tint: color(p.tint) ?? .red)
        }
        let route = coordinates(node.props["route"]).map(\.coordinate)
        RNMapView(
            pins: pins, route: route, region: mapRegion,
            fullScreen: node.bool("fullScreen") == true,
            showsUser: node.bool("showsUserLocation") == true,
            follow: node.bool("followsUserLocation") == true,
            cameraTrigger: node.double("cameraTrigger") ?? 0,
            height: cgFloat("height") ?? 120)
    }

    /// Region from the `latitude`/`longitude`/`span` props (CX-015). When absent,
    /// nil -> the camera fits the annotations/route automatically.
    private var mapRegion: MKCoordinateRegion? {
        guard let lat = node.double("latitude"),
            let lon = node.double("longitude")
        else { return nil }
        let span = node.double("span") ?? 0.02
        return MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: lat, longitude: lon),
            span: MKCoordinateSpan(latitudeDelta: span, longitudeDelta: span))
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
                // clampedInt: a huge JS value would trap the plain Int() (M3).
                model.optimisticInt(node.id)
                    ?? RNStyle.clampedInt(node.double("value") ?? 0)
            },
            set: { newValue in
                model.dispatchOptimistic(
                    nodeId: node.id, value: .number(Double(newValue)),
                    payload: ["value": newValue]
                )
            }
        )
    }

    /// Controlled TabView page index — the Picker pattern over `selection`:
    /// hold the swiped page optimistically until React acks the change event.
    private var tabSelectionBinding: Binding<Int> {
        Binding(
            get: {
                model.optimisticInt(node.id)
                    ?? RNStyle.clampedInt(node.double("selection") ?? 0)
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

    /// Static so LayoutModifier (a separate ViewModifier) shares it; forwards to
    /// the shared RNUI mapping so the app and widget interpreters can't drift.
    static func styleColor(_ name: String?) -> Color? {
        RNUI.color(name)
    }
}

private let navigationDestinationRootTypes: Set<String> = [
    "ScrollView", "List", "TabView", "NavigationStack",
]

private struct RoutedNavigationStack: View {
    let node: RNNode
    @EnvironmentObject private var model: ReactWatchModel
    @State private var localPath: [String] = []

    var body: some View {
        NavigationStack(path: pathBinding) {
            Group {
                ForEach(rootChildren) { child in
                    NodeView(node: child)
                }
            }
            // The root route renders here, not through NodeView, so apply its
            // a11y explicitly — mirrors NavigationRouteDestination for pushed
            // screens (else the root screen's label/hint is dropped). No-op when
            // there's no explicit root NavigationRoute (both nil).
            .modifier(
                A11yModifier(
                    label: rootRoute?.string("accessibilityLabel"),
                    hint: rootRoute?.string("accessibilityHint"))
            )
            .navigationTitle(rootTitle)
            .navigationDestination(for: String.self) { route in
                if let destination = routeNode(route) {
                    NavigationRouteDestination(node: destination)
                } else {
                    MissingNavigationRoute(route: route)
                }
            }
        }
    }

    private var controlledPath: [String]? {
        guard node.props["path"] != nil else { return nil }
        return normalized(node.stringArray("path") ?? [])
    }

    private var pathBinding: Binding<[String]> {
        Binding(
            get: {
                // Controlled stacks hold the pushed path in the OptimisticStore
                // until React acks the dispatch — the same release model every
                // other controlled input uses. The old @State pendingPath was
                // released only by a path-PROP change, so a handler that
                // DECLINED the navigation (kept its state) left native showing
                // the pushed screen forever, diverged from React.
                model.optimisticStringArray(node.id)
                    ?? controlledPath
                    ?? localPath
            },
            set: { newPath in
                let path = normalized(newPath)
                // Uncontrolled stacks own their state in localPath. Either way,
                // report the change to JS so its NavigationStack tracks the
                // active route (useParams / useIsFocused) — an uncontrolled
                // stack would otherwise leave JS pinned at "/" on every push.
                if controlledPath != nil {
                    model.dispatchOptimistic(
                        nodeId: node.id,
                        value: .array(path.map(JSONValue.string)),
                        payload: ["path": path],
                        event: "pathChange"
                    )
                } else {
                    localPath = path
                    model.dispatch(
                        nodeId: node.id, event: "pathChange",
                        payload: ["path": path]
                    )
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

/// A MapKit map with a CONTROLLED camera. Two camera modes, both native:
///   - **Follow** (`follow`): the camera tracks the live location smoothly via
///     `MapCameraPosition.userLocation` — MapKit interpolates at display rate
///     with no per-fix work crossing the bridge, so movement never stutters.
///   - **Region** (`follow == false`): the camera holds the `region` prop
///     (recompute it in JS to fit new results); between changes the user can
///     pan/zoom freely without being yanked back.
/// `showsUser` adds MapKit's own blue user-location dot (`UserAnnotation`).
/// The camera re-applies its target only when a JS-driven input changes — the
/// mode, the region, or `cameraTrigger` (a recenter nudge) — never on a user
/// pan, so panning away and tapping recenter snaps back.
private struct RNMapView: View {
    struct Pin: Identifiable {
        let id: String
        let coordinate: CLLocationCoordinate2D
        let title: String
        let systemImage: String
        let tint: Color
    }
    let pins: [Pin]
    let route: [CLLocationCoordinate2D]
    let region: MKCoordinateRegion?
    let fullScreen: Bool
    let showsUser: Bool
    let follow: Bool
    let cameraTrigger: Double
    let height: CGFloat

    @State private var position: MapCameraPosition = .automatic

    // Identity of the REQUESTED camera target. Derived only from JS inputs, so a
    // user pan (which changes MapKit's position but none of these) leaves it
    // stable and isn't undone; a new search (region), a mode flip (follow), or a
    // recenter tap (cameraTrigger) changes it and re-applies.
    private var cameraKey: String {
        let regionPart =
            region.map {
                "\($0.center.latitude),\($0.center.longitude),\($0.span.latitudeDelta)"
            } ?? "auto"
        return "\(follow):\(regionPart):\(cameraTrigger)"
    }

    /// The region as a camera position, or `.automatic` (fit annotations) when
    /// no region is given.
    private var regionPosition: MapCameraPosition {
        region.map { .region($0) } ?? .automatic
    }

    var body: some View {
        map.onChange(of: cameraKey, initial: true) {
            withAnimation {
                position =
                    follow
                    ? .userLocation(fallback: regionPosition)
                    : regionPosition
            }
        }
    }

    @ViewBuilder private var map: some View {
        let base = Map(position: $position) {
            if showsUser { UserAnnotation() }
            ForEach(pins) { p in
                Marker(p.title, systemImage: p.systemImage, coordinate: p.coordinate)
                    .tint(p.tint)
            }
            if route.count > 1 {
                MapPolyline(coordinates: route).stroke(.blue, lineWidth: 3)
            }
        }
        if fullScreen {
            base.frame(maxWidth: .infinity, maxHeight: .infinity).ignoresSafeArea()
        } else {
            base.frame(height: height)
        }
    }
}

private struct NavigationRouteDestination: View {
    let node: RNNode

    var body: some View {
        content.navigationTitle(node.string("title") ?? "")
            // The route node renders here, not through NodeView, so apply its
            // a11y explicitly (else a pushed screen's label is dropped).
            .modifier(
                A11yModifier(
                    label: node.string("accessibilityLabel"),
                    hint: node.string("accessibilityHint")))
    }

    @ViewBuilder private var content: some View {
        if let only = node.children.first,
            node.children.count == 1,
            navigationDestinationRootTypes.contains(only.type)
                // A full-screen Map owns the whole screen too — rendering it
                // inside the default ScrollView would collapse it to its minimal
                // height (the map can't fill a scroll view). Let it through raw,
                // whether it's the bare Map or a ZStack overlaying controls on it.
                || Self.ownsFullScreen(only)
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

    /// Whether `node` should own the whole screen (bypass the default
    /// ScrollView): a full-screen Map, or a ZStack overlaying controls on one.
    private static func ownsFullScreen(_ node: RNNode) -> Bool {
        func isFullScreenMap(_ n: RNNode) -> Bool {
            n.type == "Map" && n.bool("fullScreen") == true
        }
        if isFullScreenMap(node) { return true }
        if node.type == "ZStack" {
            return node.children.contains(where: isFullScreenMap)
        }
        return false
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
        // Normalize bounds so a reversed from/through can't trap the crown range.
        let lo = node.double("from") ?? 0
        let hi = node.double("through") ?? 100
        return VStack { ForEach(node.children) { NodeView(node: $0) } }
            .focusable()
            .digitalCrownRotation(
                binding,
                from: Swift.min(lo, hi),
                through: Swift.max(lo, hi),
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

/// Screen toolbar: <ToolbarItem placement> children land in the watchOS
/// top-bar/bottom-bar slots. Anchor-based like the presentation nodes — the
/// .toolbar modifier just needs a view inside the navigation content.
private struct ToolbarNode: View {
    let node: RNNode

    var body: some View {
        Color.clear.frame(width: 0, height: 0)
            .toolbar {
                ToolbarItemGroup(placement: .topBarLeading) {
                    items(in: "topBarLeading")
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    items(in: "topBarTrailing")
                }
                ToolbarItemGroup(placement: .bottomBar) {
                    items(in: "bottomBar")
                }
            }
    }

    @ViewBuilder private func items(in placement: String) -> some View {
        ForEach(
            node.children.filter {
                $0.type == "ToolbarItem" && $0.string("placement") == placement
            }
        ) { item in
            ForEach(item.children) { NodeView(node: $0) }
        }
    }
}

/// System alert / confirmation dialog (`dialog: true`), React-controlled the
/// same way as Toggle: `presented` is the source of truth, dismissal
/// dispatches an optimistic change(false), and each <AlertAction> child
/// becomes a system button whose tap dispatches press on ITS node id. The
/// anchor is a zero-size clear view — presentation modifiers just need any
/// view in the hierarchy.
private struct AlertNode: View {
    let node: RNNode
    let dialog: Bool
    @EnvironmentObject private var model: ReactWatchModel

    var body: some View {
        let title = node.string("title") ?? ""
        let anchor = Color.clear.frame(width: 0, height: 0)
        if dialog {
            anchor.confirmationDialog(
                title, isPresented: presentedBinding(node: node, model: model)
            ) {
                alertActionButtons(node: node, model: model)
            }
        } else {
            anchor.alert(
                title, isPresented: presentedBinding(node: node, model: model)
            ) {
                alertActionButtons(node: node, model: model)
            } message: {
                if let message = node.string("message") { Text(message) }
            }
        }
    }
}

/// Modal sheet (full-screen on watchOS), controlled like AlertNode; the
/// node's children are the sheet content.
private struct SheetNode: View {
    let node: RNNode
    @EnvironmentObject private var model: ReactWatchModel

    var body: some View {
        Color.clear.frame(width: 0, height: 0)
            .sheet(isPresented: presentedBinding(node: node, model: model)) {
                ForEach(node.children) { child in
                    NodeView(node: child)
                }
            }
    }
}

/// The controlled `presented` binding shared by Alert/ConfirmationDialog/
/// Sheet — the Toggle pattern: optimistic local value until React acks.
@MainActor private func presentedBinding(
    node: RNNode, model: ReactWatchModel
) -> Binding<Bool> {
    Binding(
        get: {
            // Without an onChange handler React can never observe the
            // dismissal, so the CX-010 ack would snap `presented` back to
            // true and the system would re-present forever. A handler-less
            // presentation therefore never presents (the read-only rule the
            // other controlled inputs get via .disabled).
            guard node.bool("onChange") == true else { return false }
            return model.optimisticBool(node.id) ?? node.bool("presented") ?? false
        },
        set: { newValue in
            model.dispatchOptimistic(
                nodeId: node.id, value: .bool(newValue),
                payload: ["value": newValue]
            )
        }
    )
}

/// <AlertAction> children -> system buttons. The system dismisses on tap
/// (which fires the binding's change(false)); the action's own press is
/// dispatched against the ACTION node so React runs the right handler.
@MainActor @ViewBuilder private func alertActionButtons(
    node: RNNode, model: ReactWatchModel
) -> some View {
    ForEach(node.children.filter { $0.type == "AlertAction" }) { action in
        Button(
            action.string("label") ?? "",
            role: buttonRole(action.string("role"))
        ) {
            _ = model.dispatch(nodeId: action.id, event: "press")
        }
        // The action node is expanded here, not rendered through NodeView, so
        // apply its a11y explicitly (else dropped).
        .modifier(
            A11yModifier(
                label: action.string("accessibilityLabel"),
                hint: action.string("accessibilityHint")))
    }
}

private func buttonRole(_ name: String?) -> ButtonRole? {
    switch name {
    case "destructive": .destructive
    case "cancel": .cancel
    default: nil
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
    /// Honor the user's Reduce Motion accessibility setting: a node's
    /// `animation` prop is suppressed when it's on (see `animated`). SwiftUI
    /// updates this live, so toggling the setting re-renders without a poll.
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        animated(
            content
                .modifier(
                    PaddingModifier(insets: RNStyle.padding(from: node.props["padding"]))
                )
                .modifier(
                    BackgroundModifier(
                        background: NodeView.styleColor(node.string("background")),
                        cornerRadius: node.double("cornerRadius").map { CGFloat($0) }
                    )
                )
                .modifier(FrameModifier(frame: RNStyle.frame(from: node.props["frame"])))
                .opacity(node.double("opacity") ?? 1)
                .modifier(TintModifier(tint: NodeView.styleColor(node.string("tint"))))
        )
    }

    /// Attaches `.animation(_:value:)` ONLY when this node actually declares an
    /// animation. An unconditional `.animation(nil, value: node)` on every node
    /// isn't a no-op — it sets an explicit nil transaction that shadows an
    /// ancestor's animation for the entire subtree, so a parent could never
    /// animate its children's changes. RNNode is Equatable, so any prop/subtree
    /// change is the trigger.
    @ViewBuilder private func animated(_ styled: some View) -> some View {
        // Suppress the declared animation under Reduce Motion (accessibility):
        // the value change still commits, it just isn't animated. getDeviceInfo
        // also exposes `reduceMotion` so JS-driven transitions can honor it too.
        if !reduceMotion,
            let animation = swiftUIAnimation(
                RNStyle.animation(from: node.props["animation"]))
        {
            styled.animation(animation, value: node)
        } else {
            styled
        }
    }

    private func swiftUIAnimation(_ spec: RNStyle.AnimationSpec?) -> Animation? {
        guard let spec else { return nil }
        return switch (spec.kind, spec.duration) {
        case (.spring, let d?): .spring(duration: d)
        case (.spring, nil): .spring
        case (.ease, let d?): .easeInOut(duration: d)
        case (.ease, nil): .easeInOut
        case (.easeIn, let d?): .easeIn(duration: d)
        case (.easeIn, nil): .easeIn
        case (.easeOut, let d?): .easeOut(duration: d)
        case (.easeOut, nil): .easeOut
        case (.linear, let d?): .linear(duration: d)
        case (.linear, nil): .linear
        }
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
