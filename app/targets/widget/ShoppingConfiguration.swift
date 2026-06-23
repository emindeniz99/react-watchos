import AppIntents
import Foundation
import ReactWatchCore
import SwiftUI
import WidgetKit

/// Configurable shopping complication: the user picks WHICH list to show while
/// editing the watch face (WidgetKit `AppIntentConfiguration`). The picker's
/// options and the rendered content both come from JS — the lists live in App
/// Group storage (written by demo/shoppingStore.ts), and React renders one
/// timeline per list under the key "shopping/<id>". This Swift layer only reads
/// the JS-owned data and selects the configured key; it authors no UI or data.
/// NOTE: untested until built with Xcode on macOS (WidgetKit + AppIntents).

// MARK: - Reading the JS-owned shopping lists from App Group storage

/// Mirrors the JS ShoppingList shape (demo/shoppingStore.ts).
private struct StoredShoppingList: Codable {
    let id: String
    let name: String
}

private enum ShoppingData {
    /// The JS Storage API persists JSON under "<storagePrefix><key>".
    private static func string(forKey key: String) -> String? {
        UserDefaults(suiteName: WidgetStore.appGroupId)?
            .string(forKey: WidgetStore.storagePrefix + key)
    }

    static func lists() -> [StoredShoppingList] {
        guard let json = string(forKey: "shopping.lists"),
              let lists = try? JSONDecoder().decode(
                  [StoredShoppingList].self, from: Data(json.utf8))
        else { return [] }
        return lists
    }

    /// The list chosen in-app (setFeaturedList); JS stores it as a JSON string
    /// or null.
    static func featuredId() -> String? {
        guard let json = string(forKey: "shopping.featuredListId"),
              let id = try? JSONDecoder().decode(String?.self, from: Data(json.utf8))
        else { return nil }
        return id
    }

    /// The list a complication shows when the user hasn't picked one: the
    /// in-app featured list, else the first list.
    static func defaultId() -> String? {
        featuredId() ?? lists().first?.id
    }
}

// MARK: - The list the user picks while editing the watch face

struct ShoppingListEntity: AppEntity {
    let id: String
    let name: String

    static var typeDisplayRepresentation: TypeDisplayRepresentation {
        "Shopping List"
    }
    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)")
    }
    static var defaultQuery = ShoppingListQuery()
}

/// Resolves entities from the JS-owned lists in App Group storage.
struct ShoppingListQuery: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [ShoppingListEntity] {
        ShoppingData.lists()
            .filter { identifiers.contains($0.id) }
            .map { ShoppingListEntity(id: $0.id, name: $0.name) }
    }

    func suggestedEntities() async throws -> [ShoppingListEntity] {
        ShoppingData.lists().map { ShoppingListEntity(id: $0.id, name: $0.name) }
    }
}

struct SelectShoppingListIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource { "Shopping List" }
    static var description: IntentDescription {
        IntentDescription("Choose which shopping list this complication shows.")
    }

    @Parameter(title: "List")
    var list: ShoppingListEntity?
}

// MARK: - Timeline provider (renders the configured list's React timeline)

struct ShoppingTimelineProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> ReactEntry {
        ReactEntry(date: .now, node: nil, url: nil, relevance: nil)
    }

    /// Gallery presets: offer one per list, so each list is a ready-made
    /// complication the user can drop on a face (and still re-pick later).
    func recommendations() -> [AppIntentRecommendation<SelectShoppingListIntent>] {
        let lists = ShoppingData.lists()
        guard !lists.isEmpty else {
            return [
                AppIntentRecommendation(
                    intent: SelectShoppingListIntent(), description: Text("Shopping"))
            ]
        }
        return lists.map { list in
            let intent = SelectShoppingListIntent()
            intent.list = ShoppingListEntity(id: list.id, name: list.name)
            return AppIntentRecommendation(intent: intent, description: Text(list.name))
        }
    }

    func snapshot(
        for configuration: SelectShoppingListIntent, in context: Context
    ) async -> ReactEntry {
        latestEntry(for: configuration, family: context.family)
            ?? placeholder(in: context)
    }

    func timeline(
        for configuration: SelectShoppingListIntent, in context: Context
    ) async -> Timeline<ReactEntry> {
        // Prefer a fresh React render (runs here via QuickJS); fall back to the
        // payload the app last published — same policy as ReactTimelineProvider.
        let payload = newestPayload(
            WidgetStore.load(), IntentRuntime.renderFreshTimelines())
        guard let timeline = payload?.widgets[key(for: configuration)]?[
                  familyKey(context.family)],
              !timeline.entries.isEmpty else {
            return Timeline(entries: [placeholder(in: context)], policy: .atEnd)
        }
        let entries = timeline.entries.map(reactEntry(from:))
        let policy: TimelineReloadPolicy =
            timeline.reloadAfterDate.map { .after($0) } ?? .atEnd
        return Timeline(entries: entries, policy: policy)
    }

    /// The published key for the selected (or default) list.
    private func key(for configuration: SelectShoppingListIntent) -> String {
        let id = configuration.list?.id ?? ShoppingData.defaultId() ?? ""
        return "shopping/\(id)"
    }

    private func latestEntry(
        for configuration: SelectShoppingListIntent, family: WidgetFamily
    ) -> ReactEntry? {
        WidgetStore.load()?.widgets[key(for: configuration)]?[familyKey(family)]?
            .entries.last.map(reactEntry(from:))
    }

    private func reactEntry(from published: PublishedEntry) -> ReactEntry {
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

    private func newestPayload(
        _ first: PublishedWidgets?, _ second: PublishedWidgets?
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

struct ShoppingWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: "shopping",
            intent: SelectShoppingListIntent.self,
            provider: ShoppingTimelineProvider()
        ) { entry in
            reactWidgetView(entry)
        }
        .configurationDisplayName("Shopping")
        .description("A shopping list's progress — pick the list, React renders it.")
        .supportedFamilies([
            .accessoryCircular,
            .accessoryCorner,
            .accessoryRectangular,
            .accessoryInline,
        ])
    }
}
