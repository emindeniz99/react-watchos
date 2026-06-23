import ReactWatchCore
import AppIntents
import SwiftUI
import WidgetKit

/// React-authored complications, Smart Stack widgets, and controls. The
/// watch app (or this extension's own QuickJS, for control intents and
/// stale refreshes) renders timelines with React and persists them to the
/// App Group; the providers below only decode and display.
/// NOTE: untested until built with Xcode on macOS.

struct ReactEntry: TimelineEntry {
    let date: Date
    let node: RNNode?
    let url: URL?
    let relevance: TimelineEntryRelevance?
}

struct ReactTimelineProvider: TimelineProvider {
    /// Must match the `kind` registered on the JS side.
    let kind: String

    func placeholder(in context: Context) -> ReactEntry {
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
              !timeline.entries.isEmpty else {
            completion(Timeline(entries: [placeholder(in: context)], policy: .atEnd))
            return
        }
        let entries = timeline.entries.map { entry(from: $0) }
        let policy: TimelineReloadPolicy =
            timeline.reloadAfterDate.map { .after($0) } ?? .atEnd
        // Per-entry relevance score (above) is the Smart Stack ranking signal.
        // Date/location `relevantContexts` (decoded into timeline) feed the
        // Smart Stack's contextual surfacing; the WidgetRelevances mapping is
        // a watchOS-version-specific API and the remaining native step.
        completion(Timeline(entries: entries, policy: policy))
    }

    /// Date/location relevance hints published from React (js/src/widgets.ts).
    /// Available to a future WidgetRelevances/RelevantContext mapping.
    var relevantContexts: [PublishedRelevantContext] {
        WidgetStore.load()?.widgets[kind]?[familyKey(.accessoryInline)]?
            .relevantContexts ?? []
    }

    private func entry(from published: PublishedEntry) -> ReactEntry {
        ReactEntry(
            date: published.entryDate,
            node: published.tree,
            url: published.url.flatMap(URL.init(string:)),
            relevance: published.relevance.map {
                TimelineEntryRelevance(
                    score: Float($0.score),
                    duration: ($0.durationMs ?? 0) / 1000)
            })
    }

    private func latestEntry(for context: Context) -> ReactEntry? {
        WidgetStore.load()?.widgets[kind]?[familyKey(context.family)]?
            .entries.last.map { entry(from: $0) }
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

@ViewBuilder private func reactWidgetView(_ entry: ReactEntry) -> some View {
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
    // Computed (not static let) so republished React metadata is picked
    // up on every render instead of being frozen at process start.
    private var metadata: PublishedControl? {
        WidgetStore.load()?.controls?["hydration.addGlass"]
    }

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "hydration.addGlass") {
            ControlWidgetButton(action: AddGlassIntent()) {
                Label(
                    metadata?.label ?? "Add Glass",
                    systemImage: metadata?.systemName ?? "drop.fill")
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
        DaypartWidget()
        if #available(watchOS 26.0, *) {
            AddGlassControl()
        }
    }
}
