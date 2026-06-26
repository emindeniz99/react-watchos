import AppIntents
import CoreLocation
import ReactWatchCore
import ReactWatchSupport
import RelevanceKit
import SwiftUI
import WidgetKit

// React-authored complications, Smart Stack widgets, and controls. The
// watch app (or this extension's own QuickJS, for control intents and
// stale refreshes) renders timelines with React and persists them to the
// App Group; the providers below only decode and display.
// NOTE: untested until built with Xcode on macOS.

struct ReactEntry: TimelineEntry {
    let date: Date
    let node: RNNode?
    let url: URL?
    let relevance: TimelineEntryRelevance?
}

struct ReactTimelineProvider: TimelineProvider {
    /// Must match the `kind` registered on the JS side.
    let kind: String

    func placeholder(in _: Context) -> ReactEntry {
        ReactEntry(date: .now, node: nil, url: nil, relevance: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (ReactEntry) -> Void) {
        completion(latestEntry(for: context) ?? placeholder(in: context))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ReactEntry>) -> Void) {
        // Prefer a fresh React render (runs in this process via QuickJS,
        // ~6MB measured, well under the widget budget); fall back to the
        // payload the app last published.
        let stored = WidgetStore.load()
        let fresh = IntentRuntime.renderFreshTimelines()
        let payload = newestPayload(stored, fresh)
        guard let timeline = payload?.widgets[kind]?[familyKey(context.family)],
            !timeline.entries.isEmpty
        else {
            completion(Timeline(entries: [placeholder(in: context)], policy: .atEnd))
            return
        }
        let entries = timeline.entries.map { entry(from: $0) }
        let policy: TimelineReloadPolicy =
            timeline.reloadAfterDate.map { .after($0) } ?? .atEnd
        // Per-entry relevance score (in `entry`) is the Smart Stack *ranking*
        // signal; the *predictive* date/location surfacing comes from
        // `relevance()` below (CX-017).
        completion(Timeline(entries: entries, policy: policy))
    }

    /// Maps React's published date/location hints (`relevantContexts`) to
    /// RelevanceKit so the Smart Stack surfaces this widget at the right
    /// time/place (CX-017) — the predictive complement to the per-entry
    /// `TimelineEntryRelevance` ranking. watchOS 11+ (the `relevance()` hook +
    /// RelevanceKit, which is watchOS-only and a no-op elsewhere); earlier
    /// versions use the default empty relevance. The mapping compiles + is
    /// shape-checked here, but whether the Smart Stack actually surfaces it is
    /// device-verified only.
    @available(watchOS 11.0, *)
    func relevance() async -> WidgetRelevance<Void> {
        let attributes = relevantContexts.compactMap {
            Self.relevantContext(from: $0).map {
                WidgetRelevanceAttribute<Void>(context: $0)
            }
        }
        return WidgetRelevance(attributes)
    }

    /// One RelevanceKit context per hint: a circular region when coordinates are
    /// present (default 100 m), else a date; both nil drops the hint.
    private static func relevantContext(
        from ctx: PublishedRelevantContext
    ) -> RelevantContext? {
        if let lat = ctx.latitude, let lon = ctx.longitude {
            return .location(
                CLCircularRegion(
                    center: CLLocationCoordinate2D(latitude: lat, longitude: lon),
                    radius: ctx.radius ?? 100,
                    identifier: "react-relevance-\(lat),\(lon)"
                )
            )
        }
        if let date = ctx.date {
            return .date(Date(timeIntervalSince1970: date / 1000))
        }
        return nil
    }

    /// Date/location relevance hints published from React (js/src/widgets.ts),
    /// gathered from whichever family published them (relevance is per-kind, not
    /// per-family).
    var relevantContexts: [PublishedRelevantContext] {
        guard let families = WidgetStore.load()?.widgets[kind] else { return [] }
        for timeline in families.values {
            if let contexts = timeline.relevantContexts, !contexts.isEmpty {
                return contexts
            }
        }
        return []
    }

    private func entry(from published: PublishedEntry) -> ReactEntry {
        ReactEntry(
            date: published.entryDate,
            node: published.tree,
            url: published.url.flatMap(URL.init(string:)),
            relevance: published.relevance.map {
                TimelineEntryRelevance(
                    score: Float($0.score),
                    duration: ($0.durationMs ?? 0) / 1000
                )
            }
        )
    }

    private func latestEntry(for context: Context) -> ReactEntry? {
        // The entry applicable *now*, not `.entries.last` (which showed the
        // end-of-day state for future-dated daypart timelines — CX-016).
        guard
            let entries = WidgetStore.load()?
                .widgets[kind]?[familyKey(context.family)]?.entries,
            let index = WidgetSnapshot.currentIndex(
                dates: entries.map(\.entryDate), now: .now
            )
        else { return nil }
        return entry(from: entries[index])
    }

    private func newestPayload(
        _ first: PublishedWidgets?,
        _ second: PublishedWidgets?
    ) -> PublishedWidgets? {
        guard let first else { return second }
        guard let second else { return first }
        return second.publishedAt >= first.publishedAt ? second : first
    }

    private func familyKey(_ family: WidgetFamily) -> String {
        switch family {
        case .accessoryCircular: "accessoryCircular"
        case .accessoryRectangular: "accessoryRectangular"
        case .accessoryInline: "accessoryInline"
        case .accessoryCorner: "accessoryCorner"
        default: "accessoryCircular"
        }
    }
}

@ViewBuilder func reactWidgetView(_ entry: ReactEntry) -> some View {
    let view = WidgetNodeView(node: entry.node)
        .containerBackground(.clear, for: .widget)
    if let url = entry.url {
        view.widgetURL(url)
    } else {
        view
    }
}

struct HydrationWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(
            kind: "hydration",
            provider: ReactTimelineProvider(kind: "hydration")
        ) { entry in
            reactWidgetView(entry)
        }
        .configurationDisplayName("Hydration")
        .description("Glasses of water today — rendered by React.")
        .supportedFamilies([
            .accessoryCircular,
            .accessoryCorner,
            .accessoryRectangular,
            .accessoryInline,
        ])
    }
}

// ShoppingWidget (configurable: pick the list while editing the watch face)
// lives in ShoppingConfiguration.swift.

/// Multi-entry timeline demo: WidgetKit swaps between pre-rendered,
/// future-dated entries with no process running; relevance scores hint
/// the Smart Stack.
struct DaypartWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(
            kind: "daypart",
            provider: ReactTimelineProvider(kind: "daypart")
        ) { entry in
            reactWidgetView(entry)
        }
        .configurationDisplayName("Time of Day")
        .description("A React timeline that updates itself all day.")
        .supportedFamilies([.accessoryRectangular, .accessoryInline])
    }
}

/// Control Center / Action button control (watchOS 26+). The visual is an
/// OS template; React owns the metadata (label/symbol come from the
/// published payload) and the behavior (the intent dispatches into the
/// React-registered handler via QuickJS).
struct AddGlassIntent: AppIntent {
    static let title: LocalizedStringResource = "Add Glass"
    static let description = IntentDescription("Log a glass of water.")

    func perform() async throws -> some IntentResult {
        IntentRuntime.handle(intent: "addGlass")
        return .result()
    }
}

@available(watchOS 26.0, *)
struct AddGlassControl: ControlWidget {
    /// Computed (not static let) so republished React metadata is picked
    /// up on every render instead of being frozen at process start.
    private var metadata: PublishedControl? {
        WidgetStore.load()?.controls?["hydration.addGlass"]
    }

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "hydration.addGlass") {
            ControlWidgetButton(action: AddGlassIntent()) {
                Label(
                    metadata?.label ?? "Add Glass",
                    systemImage: metadata?.systemName ?? "drop.fill"
                )
            }
        }
        .displayName("Add Glass")
        .description("Log a glass of water — handled by React.")
    }
}

@main
struct ReactWidgetBundle: WidgetBundle {
    var body: some Widget {
        HydrationWidget()
        ShoppingWidget()
        DaypartWidget()
        if #available(watchOS 26.0, *) {
            AddGlassControl()
        }
    }
}
