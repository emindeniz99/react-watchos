import AppIntents
import ReactWatchCore
import ReactWatchWidget
import RelevanceKit
import SwiftUI
import WidgetKit

// Configurable shopping complication: the user picks WHICH list to show while
// editing the watch face (WidgetKit `AppIntentConfiguration`). The picker's
// options and the rendered content both come from JS — the lists live in App
// Group storage (written by demo/shoppingStore.ts), and React renders one
// timeline per list under the key "shopping/<id>". This Swift layer only reads
// the JS-owned data and selects the configured key; the timeline/snapshot/
// relevance machinery comes from the ReactWatchWidget package (the same the
// static ReactTimelineProvider uses) — a configurable provider can't be fully
// packaged because its configuration intent is this app's own type.
// The configuration intent + entity/query live in ShoppingIntent.swift (shared
// with the watch app target so WidgetKit can resolve the intent).
// NOTE: untested until built with Xcode on macOS (WidgetKit + AppIntents).

// MARK: - Timeline provider (renders the configured list's React timeline)

struct ShoppingTimelineProvider: AppIntentTimelineProvider {
    func placeholder(in _: Context) -> ReactEntry { .placeholder }

    /// Gallery presets: offer one per list, so each list is a ready-made
    /// complication the user can drop on a face (and still re-pick later).
    func recommendations() -> [AppIntentRecommendation<SelectShoppingListIntent>] {
        let lists = ShoppingData.lists()
        guard !lists.isEmpty else {
            return [
                AppIntentRecommendation(
                    intent: SelectShoppingListIntent(), description: Text("Shopping")
                )
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
        reactSnapshotEntry(
            forKind: key(for: configuration), family: context.family,
            appGroupId: WidgetStore.appGroupId)
    }

    func timeline(
        for configuration: SelectShoppingListIntent, in context: Context
    ) async -> Timeline<ReactEntry> {
        reactTimeline(
            forKind: key(for: configuration), family: context.family,
            appGroupId: WidgetStore.appGroupId)
    }

    /// Per-list Smart Stack relevance (CX-017): for each shopping list that
    /// published date/location hints, surface the widget *configured to that
    /// list* at the right time/place — the configurable-widget counterpart of
    /// ReactTimelineProvider.relevance(). watchOS 11+; behaviour is device-only.
    @available(watchOS 11.0, *)
    func relevance() async -> WidgetRelevance<SelectShoppingListIntent> {
        var attributes: [WidgetRelevanceAttribute<SelectShoppingListIntent>] = []
        // ONE payload decode for the whole pass: the payload carries every
        // timeline's serialized trees, and the per-list lookup was re-decoding
        // all of it N times per relevance callback.
        let payload = reactPublishedWidgets(appGroupId: WidgetStore.appGroupId)
        for list in ShoppingData.lists() {
            let contexts = reactRelevantContexts(
                forKind: "shopping/\(list.id)", in: payload)
            guard !contexts.isEmpty else { continue }
            let intent = SelectShoppingListIntent()
            intent.list = ShoppingListEntity(id: list.id, name: list.name)
            for ctx in contexts {
                if let relevant = reactRelevantContext(from: ctx) {
                    attributes.append(
                        WidgetRelevanceAttribute(configuration: intent, context: relevant)
                    )
                }
            }
        }
        return WidgetRelevance(attributes)
    }

    /// The published key for the selected (or default) list.
    private func key(for configuration: SelectShoppingListIntent) -> String {
        let id = configuration.list?.id ?? ShoppingData.defaultId() ?? ""
        return "shopping/\(id)"
    }
}

struct ShoppingWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: "shopping",
            intent: SelectShoppingListIntent.self,
            provider: ShoppingTimelineProvider()
        ) { entry in
            reactWidgetView(entry, appGroupId: WidgetStore.appGroupId)
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
