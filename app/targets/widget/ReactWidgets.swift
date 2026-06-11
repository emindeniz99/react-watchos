import SwiftUI
import WidgetKit

/// React-authored complications. The watch app renders timelines with
/// React (js/src/widgets.ts), persists them to the App Group, and calls
/// WidgetCenter.reloadAllTimelines(); this extension only decodes and
/// displays them. NOTE: untested until built with Xcode on macOS.

struct ReactEntry: TimelineEntry {
    let date: Date
    let node: RNNode?
}

struct ReactTimelineProvider: TimelineProvider {
    /// Must match the `kind` registered on the JS side.
    let kind: String

    func placeholder(in context: Context) -> ReactEntry {
        ReactEntry(date: .now, node: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (ReactEntry) -> Void) {
        completion(latestEntry(for: context) ?? placeholder(in: context))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ReactEntry>) -> Void) {
        guard let timeline = storedTimeline(for: context),
              !timeline.entries.isEmpty else {
            completion(Timeline(entries: [placeholder(in: context)], policy: .atEnd))
            return
        }
        let entries = timeline.entries.map {
            ReactEntry(date: $0.entryDate, node: $0.tree)
        }
        let policy: TimelineReloadPolicy =
            timeline.reloadAfterDate.map { .after($0) } ?? .atEnd
        completion(Timeline(entries: entries, policy: policy))
    }

    private func storedTimeline(for context: Context) -> PublishedFamilyTimeline? {
        WidgetStore.load()?.widgets[kind]?[familyKey(context.family)]
    }

    private func latestEntry(for context: Context) -> ReactEntry? {
        storedTimeline(for: context)?.entries.last.map {
            ReactEntry(date: $0.entryDate, node: $0.tree)
        }
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

struct HydrationWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(
            kind: "hydration",
            provider: ReactTimelineProvider(kind: "hydration")
        ) { entry in
            WidgetNodeView(node: entry.node)
                .containerBackground(.clear, for: .widget)
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

@main
struct ReactWidgetBundle: WidgetBundle {
    var body: some Widget {
        HydrationWidget()
    }
}
