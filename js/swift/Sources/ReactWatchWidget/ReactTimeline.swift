#if os(watchOS)
import CoreLocation
import Foundation
import ReactWatchCore
import ReactWatchSupport
import RelevanceKit
import SwiftUI
import WidgetKit

// React-authored complications, Smart Stack widgets, and controls. The watch
// app (or this extension's own QuickJS, for control intents and stale
// refreshes) renders timelines with React and persists them to the App Group;
// the pieces here only decode and display. A consumer supplies the App Group
// id (the same one their watch app passes to ReactWatchRootView) — nothing
// here holds global state.
// NOTE: untested until built with Xcode on macOS (WidgetKit).

/// One pre-rendered widget entry: a React tree, an optional deep-link, and an
/// optional Smart Stack ranking score for the moment `date`.
public struct ReactEntry: TimelineEntry {
    public let date: Date
    public let node: RNNode?
    public let url: URL?
    public let relevance: TimelineEntryRelevance?

    public init(
        date: Date, node: RNNode?, url: URL?,
        relevance: TimelineEntryRelevance?
    ) {
        self.date = date
        self.node = node
        self.url = url
        self.relevance = relevance
    }

    /// Placeholder/redacted state before the app publishes data. Computed
    /// (its `date` is the moment of access) rather than a stored static.
    public static var placeholder: ReactEntry {
        ReactEntry(date: .now, node: nil, url: nil, relevance: nil)
    }
}

// MARK: - Timeline building blocks (shared by the static provider here and a
// consumer's own AppIntentTimelineProvider for configurable widgets)

/// The full timeline for a widget `kind` + `family`: a fresh React render
/// (runs in this process via QuickJS, ~6MB measured, well under the widget
/// budget) merged with the payload the app last published, mapped to entries
/// with WidgetKit's reload policy. A single placeholder when nothing matches.
public func reactTimeline(
    forKind kind: String, family: WidgetFamily, appGroupId: String
) -> Timeline<ReactEntry> {
    let stored = SharedWidgetStore(appGroupId: appGroupId).loadPublishedWidgets()
    // Fresh-render (a full in-extension QuickJS boot) ONLY when the stored
    // payload can no longer cover this widget — the header's "decode and
    // display, render on stale refreshes" contract. Reloads that arrive while
    // the store is current (the app's own publish→reloadAllTimelines, an
    // intent that just republished, a system snapshot) decode the stored
    // payload instead of re-rendering the same data, which both saves the
    // engine boot and stops an intent tap from paying for TWO boots.
    let storedIsCurrent: Bool = {
        guard let stored,
            let timeline = stored.widgets[kind]?[familyKey(family)]
        else { return false }
        return WidgetSnapshot.isCurrent(
            entryDates: timeline.entries.map(\.entryDate),
            reloadAfter: timeline.reloadAfterDate,
            publishedAt: Date(timeIntervalSince1970: stored.publishedAt / 1000),
            now: Date())
    }()
    let fresh =
        storedIsCurrent
        ? nil : WidgetIntentRuntime.renderFreshTimelines(appGroupId: appGroupId)
    let payload = WidgetSnapshot.newestPayload(stored, fresh)
    guard let timeline = payload?.widgets[kind]?[familyKey(family)],
        !timeline.entries.isEmpty
    else {
        return Timeline(entries: [.placeholder], policy: .atEnd)
    }
    // Drop entries already in the past — except the one applicable NOW
    // (WidgetSnapshot's rule, NF-17): handing WidgetKit stale leading entries
    // shows an out-of-date first frame until it advances. All-future
    // timelines keep every entry (currentIndex points at the earliest).
    let published = timeline.entries
    let start =
        WidgetSnapshot.currentIndex(
            dates: published.map(\.entryDate), now: Date()) ?? 0
    let entries = published[start...].map(reactEntry(from:))
    let policy: TimelineReloadPolicy =
        timeline.reloadAfterDate.map { .after($0) } ?? .atEnd
    return Timeline(entries: entries, policy: policy)
}

/// The entry applicable *now* for a snapshot — not `.entries.last` (which
/// showed the end-of-day state for future-dated daypart timelines, CX-016).
/// Falls back to the placeholder. Reads the last published payload (snapshots
/// must be fast, so no fresh render here).
public func reactSnapshotEntry(
    forKind kind: String, family: WidgetFamily, appGroupId: String
) -> ReactEntry {
    guard
        let entries = SharedWidgetStore(appGroupId: appGroupId)
            .loadPublishedWidgets()?.widgets[kind]?[familyKey(family)]?.entries,
        let index = WidgetSnapshot.currentIndex(
            dates: entries.map(\.entryDate), now: .now)
    else { return .placeholder }
    return reactEntry(from: entries[index])
}

/// The last-published payload, decoded once. The payload carries EVERY
/// timeline's serialized trees, so a provider callback that needs several
/// lookups (an N-list relevance pass, control metadata + timelines) should
/// decode it once with this and hand it to the `in payload:` variants below
/// instead of paying a full JSON decode per lookup.
public func reactPublishedWidgets(appGroupId: String) -> PublishedWidgets? {
    SharedWidgetStore(appGroupId: appGroupId).loadPublishedWidgets()
}

/// The label/symbol a React-published control should show (the visual is an
/// OS template; React owns the metadata). nil when nothing's published for
/// `intent`, so the consumer can supply a static default.
public func reactControlMetadata(
    _ intent: String, appGroupId: String
) -> (label: String, systemName: String?)? {
    reactControlMetadata(intent, in: reactPublishedWidgets(appGroupId: appGroupId))
}

/// Payload-accepting variant — reuse one decoded payload across lookups.
public func reactControlMetadata(
    _ intent: String, in payload: PublishedWidgets?
) -> (label: String, systemName: String?)? {
    guard let control = payload?.controls?[intent] else { return nil }
    return (control.label, control.systemName)
}

/// The relevance hints published for a widget `kind`, from whichever family
/// carries them (relevance is per-kind, not per-family).
public func reactRelevantContexts(
    forKind kind: String, appGroupId: String
) -> [PublishedRelevantContext] {
    reactRelevantContexts(
        forKind: kind, in: reactPublishedWidgets(appGroupId: appGroupId))
}

/// Payload-accepting variant — reuse one decoded payload across lookups.
public func reactRelevantContexts(
    forKind kind: String, in payload: PublishedWidgets?
) -> [PublishedRelevantContext] {
    guard let families = payload?.widgets[kind] else { return [] }
    for timeline in families.values {
        if let contexts = timeline.relevantContexts, !contexts.isEmpty {
            return contexts
        }
    }
    return []
}

/// Maps a React-published relevance hint to a RelevanceKit context: a circular
/// region when coordinates are present (default 100 m), else a date; both nil
/// drops the hint. Used by the static (Void) provider and a consumer's
/// configurable (intent) provider (CX-017).
@available(watchOS 11.0, *)
public func reactRelevantContext(
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

func reactEntry(from published: PublishedEntry) -> ReactEntry {
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

func familyKey(_ family: WidgetFamily) -> String {
    switch family {
    case .accessoryCircular: "accessoryCircular"
    case .accessoryRectangular: "accessoryRectangular"
    case .accessoryInline: "accessoryInline"
    case .accessoryCorner: "accessoryCorner"
    default: "accessoryCircular"
    }
}

// MARK: - Static timeline provider (StaticConfiguration widgets)

/// Drop-in `TimelineProvider` for a non-configurable React widget: pass the
/// `kind` registered on the JS side and the App Group id. Configurable widgets
/// (AppIntentConfiguration) write their own provider using the building blocks
/// above, since the configuration intent is the consumer's type.
public struct ReactTimelineProvider: TimelineProvider {
    let kind: String
    let appGroupId: String

    public init(kind: String, appGroupId: String) {
        self.kind = kind
        self.appGroupId = appGroupId
    }

    public func placeholder(in _: Context) -> ReactEntry { .placeholder }

    public func getSnapshot(
        in context: Context, completion: @escaping (ReactEntry) -> Void
    ) {
        completion(
            reactSnapshotEntry(
                forKind: kind, family: context.family, appGroupId: appGroupId))
    }

    public func getTimeline(
        in context: Context, completion: @escaping (Timeline<ReactEntry>) -> Void
    ) {
        completion(
            reactTimeline(
                forKind: kind, family: context.family, appGroupId: appGroupId))
    }

    /// Maps React's published date/location hints to RelevanceKit so the Smart
    /// Stack surfaces this widget at the right time/place (CX-017). watchOS
    /// 11+; earlier versions use the default empty relevance.
    @available(watchOS 11.0, *)
    public func relevance() async -> WidgetRelevance<Void> {
        let attributes = reactRelevantContexts(forKind: kind, appGroupId: appGroupId)
            .compactMap {
                reactRelevantContext(from: $0).map {
                    WidgetRelevanceAttribute<Void>(context: $0)
                }
            }
        return WidgetRelevance(attributes)
    }
}
#endif
