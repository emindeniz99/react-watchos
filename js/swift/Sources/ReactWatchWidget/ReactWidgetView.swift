#if os(watchOS)
import Charts
import ReactWatchCore
import ReactWatchSupport
import ReactWatchUI
import SwiftUI
import UIKit
import os

/// Logs each unsupported widget node type once (the body re-renders, so a raw
/// log would flood). An unknown type means a newer JS bundle reached an older
/// widget interpreter; we skip it to degrade gracefully but make it diagnosable.
private let widgetInterpreterLog = Logger(
    subsystem: "com.reactwatchos.widget", category: "widget-interpreter")
private let loggedUnsupportedWidgetTypes = OSAllocatedUnfairLock(
    initialState: Set<String>())

private func unsupportedWidgetNode(_ type: String) -> some View {
    let isNew = loggedUnsupportedWidgetTypes.withLock { $0.insert(type).inserted }
    if isNew {
        widgetInterpreterLog.error(
            "tried to render unsupported widget node type '\(type, privacy: .public)' — skipped; rebuild the bundle or update the app"
        )
    }
    return EmptyView()
}

/// Non-interactive interpreter for React-rendered widget trees. Same node
/// vocabulary as the watch app's NodeView, minus events (WidgetKit views
/// are static) and navigation. nil renders the placeholder.
public struct WidgetNodeView: View {
    let node: RNNode?
    /// Threaded through so an interactive Button node can dispatch its `intent`
    /// into the extension's React runtime for this consumer's App Group.
    let appGroupId: String

    public init(node: RNNode?, appGroupId: String) {
        self.node = node
        self.appGroupId = appGroupId
    }

    public var body: some View {
        if let node {
            // Same wrapping order as the app's NodeView chain (layout inner,
            // a11y outermost), so the accessibility element spans the padded/
            // filled region in both interpreters.
            applyA11y(applyLayout(render(node), node), node)
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

    /// Design-system Tier 1 parity with NodeView.LayoutModifier — same props,
    /// same RNStyle parsing, same application order (padding -> background +
    /// cornerRadius -> frame -> opacity -> tint).
    @ViewBuilder private func applyLayout(
        _ content: some View, _ node: RNNode
    ) -> some View {
        let insets = RNStyle.padding(from: node.props["padding"])
        let frame = RNStyle.frame(from: node.props["frame"])
        let background = color(node.string("background"))
        let radius = node.double("cornerRadius").map { CGFloat($0) }
        let tint = color(node.string("tint"))
        padded(content, insets)
            .modifier(WidgetBackground(background: background, cornerRadius: radius))
            .modifier(WidgetFrame(frame: frame))
            .opacity(node.double("opacity") ?? 1)
            .modifier(WidgetTint(tint: tint))
    }

    @ViewBuilder private func padded(
        _ content: some View, _ insets: RNStyle.Insets?
    ) -> some View {
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

    @ViewBuilder private func render(_ node: RNNode) -> some View {
        switch node.type {
        case "VStack":
            VStack(
                alignment: RNUI.horizontalAlignment(node.string("alignment")),
                spacing: cgFloat(node, "spacing")
            ) { children(node) }
        case "HStack":
            HStack(
                alignment: RNUI.verticalAlignment(node.string("alignment")),
                spacing: cgFloat(node, "spacing")
            ) { children(node) }
        case "ZStack":
            ZStack(alignment: RNUI.zAlignment(node.string("alignment"))) {
                children(node)
            }
        case "Text":
            // Rich text parity with NodeView: element children concatenate
            // into one Text, each segment styled independently.
            if node.children.isEmpty {
                styled(node, Text(node.string("text") ?? ""))
            } else {
                styled(
                    node,
                    node.children.reduce(Text(node.string("text") ?? "")) {
                        $0 + RNUI.textSegment($1)
                    })
            }
        case "TimerText":
            timerText(node)
        case "FormattedText":
            // Locale-aware date/number text — full support: the shared
            // RNFormat kernel gives byte-identical output with the app.
            styled(node, Text(RNFormat.text(for: node)))
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
                ProgressView(value: value, total: node.double("total") ?? 1) {
                    Text(node.string("label") ?? "")
                }
            } else {
                ProgressView()
            }
        // Interactive/navigation nodes degrade to their content.
        case "Button":
            button(node)
        case "NavigationStack":
            // Match the watch: only the root ("/") route renders inline; other
            // routes are off-screen destinations and must not leak into the
            // complication (widget has no navigation).
            navigationStackRoot(node)
        case "NavigationLink":
            // Mirror NodeView.navigationLinkLabel: the label-based form (no
            // children) must still show its visible text.
            if let label = node.string("label") {
                Text(label)
            } else if node.children.isEmpty {
                Text(node.string("to") ?? "")
            } else {
                children(node)
            }
        case "NavigationRoute", "ScrollView", "List", "TabView", "CrownRotation":
            children(node)
        // Widgets cannot present anything — presentation surfaces degrade to
        // nothing (their content only exists while presented in the app).
        case "Alert", "AlertAction", "ConfirmationDialog", "Sheet":
            EmptyView()
        case "Section":
            // Degraded grouping: header text above the rows, no List styling.
            VStack(alignment: .leading, spacing: 2) {
                if let header = node.string("header") {
                    Text(header).font(.footnote).foregroundStyle(.secondary)
                }
                children(node)
                if let footer = node.string("footer") {
                    Text(footer).font(.footnote).foregroundStyle(.secondary)
                }
            }
        case "Label":
            SwiftUI.Label(
                node.string("label") ?? "",
                systemImage: node.string("systemName") ?? "circle"
            )
            .foregroundStyle(color(node.string("color")) ?? .primary)
        case "Grid":
            Grid(
                horizontalSpacing: cgFloat(node, "horizontalSpacing"),
                verticalSpacing: cgFloat(node, "verticalSpacing")
            ) {
                ForEach(node.children.filter { $0.type == "GridRow" }) { row in
                    // The row node is expanded here, not rendered through
                    // WidgetNodeView, so apply its a11y explicitly (else dropped).
                    applyA11y(
                        GridRow {
                            ForEach(row.children) { child in
                                WidgetNodeView(node: child, appGroupId: appGroupId)
                            }
                        }, row)
                }
            }
        case "GridRow":
            HStack { children(node) }
        case "ShareLink":
            // Widgets can't present a share sheet: degrade to the label.
            if node.children.isEmpty {
                Image(systemName: "square.and.arrow.up")
            } else {
                children(node)
            }
        case "Chart":
            chart(node)
        case "LabeledContent":
            LabeledContent(node.string("label") ?? "") {
                if node.children.isEmpty {
                    Text(node.string("value") ?? "")
                } else {
                    children(node)
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
        case "Toolbar", "ToolbarItem":
            // No toolbar chrome in a widget.
            EmptyView()
        case "Toggle":
            Text(node.string("label") ?? "")
        case "Slider", "Stepper":
            // Read-only in widgets: show the value as a fraction. Defaults mirror
            // the app interpreter — Slider spans 0...1, Stepper 0...100 — so the
            // implicit-range fraction reads the same in both.
            let lo = node.double("from") ?? 0
            let hi = node.double("through") ?? (node.type == "Stepper" ? 100 : 1)
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
        case "SecureField":
            // A secret never belongs on a complication — show only the
            // placeholder, never the (masked or plain) value.
            Text(node.string("placeholder") ?? "")
        case "Picker":
            Text(pickerSummary(node))
        default:
            // Unknown node type: skip it (graceful degradation) but log it once
            // per type so the skip isn't silent.
            unsupportedWidgetNode(node.type)
        }
    }

    private func children(_ node: RNNode) -> some View {
        ForEach(node.children) { child in
            WidgetNodeView(node: child, appGroupId: appGroupId)
        }
    }

    /// The root ("/") route's content of a NavigationStack, mirroring the watch's
    /// RoutedNavigationStack.rootChildren: render only the root route (destination
    /// routes stay hidden), or the non-route children when there is no explicit
    /// root NavigationRoute.
    @ViewBuilder private func navigationStackRoot(_ node: RNNode) -> some View {
        let routes = node.children.filter { $0.type == "NavigationRoute" }
        if let root = routes.first(where: {
            normalizedPath($0.string("path") ?? "/") == "/"
        }) {
            // The root route renders its children directly here, so apply the
            // route node's own a11y (matches the app's RoutedNavigationStack;
            // else the root screen's label/hint is dropped in the widget).
            applyA11y(children(root), root)
        } else {
            ForEach(node.children.filter { $0.type != "NavigationRoute" }) {
                child in
                WidgetNodeView(node: child, appGroupId: appGroupId)
            }
        }
    }

    /// Path normalization matching NodeView.normalized(_ route:).
    private func normalizedPath(_ route: String) -> String {
        if route.isEmpty || route == "/" { return "/" }
        return route.hasPrefix("/") ? route : "/\(route)"
    }

    /// An interactive widget button (watchOS 11+): a tap runs the React intent
    /// named by the `intent` prop in the extension, with no app launch. Without
    /// an `intent` prop, or on watchOS 10, it degrades to its (static) content —
    /// `onPress` is an in-app gesture that can't fire from a widget timeline.
    @ViewBuilder private func button(_ node: RNNode) -> some View {
        if #available(watchOS 11.0, *), let intent = node.string("intent") {
            Button(
                intent: ReactWidgetButtonIntent(
                    name: intent, appGroupId: appGroupId)
            ) {
                children(node)
            }
            .buttonStyle(.plain)
        } else {
            children(node)
        }
    }

    @ViewBuilder private func gauge(_ node: RNNode) -> some View {
        // Shared normalization (M4): the widget building `min...max` raw while
        // the app normalized meant the same wire tree rendered in-app but
        // trapped the extension on reversed bounds.
        let (min, max, value) = RNStyle.gaugeBounds(
            min: node.double("min"), max: node.double("max"),
            value: node.double("value"))
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
        RNUI.styled(node, base)
    }

    /// Minimal Swift Charts binding, parity with NodeView.chartView.
    @ViewBuilder private func chart(_ node: RNNode) -> some View {
        let points = RNStyle.chartPoints(from: node.props["points"])
        let kind = node.string("type") ?? "line"
        let seriesColor = color(node.string("color")) ?? Color.accentColor
        Chart(Array(points.enumerated()), id: \.offset) { index, point in
            RNUI.chartMark(
                kind: kind, point: point, index: index, color: seriesColor)
        }
    }

    /// Auto-updating timer label; valid in widgets (Text(timerInterval:) is
    /// one of the few views WidgetKit ticks without a timeline reload). The
    /// `milliseconds` mode is deliberately NOT honored here: WidgetKit can't
    /// live-tick sub-second, so a frozen ms snapshot would show stale digits —
    /// the widget degrades to the clean seconds-granularity timer instead
    /// (TimerText is `widget: "degraded"` in the contract for this reason).
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
        // clampedInt: a huge JS value would trap the plain Int() (M3); the
        // saturated index just falls to the label branch below.
        let index = RNStyle.clampedInt(node.double("value") ?? 0)
        if options.indices.contains(index) { return options[index] }
        return node.string("label") ?? ""
    }

    private func formatted(_ value: Double) -> String {
        RNStyle.formatValue(value)
    }

    private func cgFloat(_ node: RNNode, _ key: String) -> CGFloat? {
        node.double(key).map { CGFloat($0) }
    }

    /// Named-set + #RRGGBB[AA] hex color -> SwiftUI.Color, shared with the app
    /// interpreter via RNUI so the two interpreters can't drift.
    private func color(_ name: String?) -> Color? {
        RNUI.color(name)
    }
}

/// Wraps a React-rendered entry in the standard widget container, applying the
/// deep-link `widgetURL` when the entry carries one. Consumers pass this as the
/// content closure of their `StaticConfiguration`/`AppIntentConfiguration`
/// (which is itself main-actor, so the @MainActor here is a no-op at the call
/// site — it just lets the body call SwiftUI's main-actor view modifiers).
@MainActor @ViewBuilder public func reactWidgetView(
    _ entry: ReactEntry, appGroupId: String
) -> some View {
    let view = WidgetNodeView(node: entry.node, appGroupId: appGroupId)
        .containerBackground(.clear, for: .widget)
    if let url = entry.url {
        view.widgetURL(url)
    } else {
        view
    }
}

private struct WidgetBackground: ViewModifier {
    let background: Color?
    let cornerRadius: CGFloat?

    func body(content: Content) -> some View {
        if let background, let cornerRadius {
            content.background(
                background, in: RoundedRectangle(cornerRadius: cornerRadius))
        } else if let background {
            content.background(background)
        } else if let cornerRadius {
            content.clipShape(RoundedRectangle(cornerRadius: cornerRadius))
        } else {
            content
        }
    }
}

private struct WidgetFrame: ViewModifier {
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

private struct WidgetTint: ViewModifier {
    let tint: Color?

    func body(content: Content) -> some View {
        if let tint { content.tint(tint) } else { content }
    }
}

#endif
