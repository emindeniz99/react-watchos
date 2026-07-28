#if os(watchOS)
import CoreLocation
import Foundation
import MapKit
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
    let sharedStore = SharedWidgetStore(appGroupId: appGroupId)
    let stored = sharedStore.loadPublishedWidgets()
    // Fresh-render (a full in-extension QuickJS boot) ONLY when the stored
    // payload can no longer cover this widget — the header's "decode and
    // display, render on stale refreshes" contract. Reloads that arrive while
    // the store is current (the app's own publish→reloadAllTimelines, an
    // intent that just republished, a system snapshot) decode the stored
    // payload instead of re-rendering the same data, which both saves the
    // engine boot and stops an intent tap from paying for TWO boots.
    //
    // "Current" is the ARCH-06 verdict, not a date comparison: the payload also
    // has to derive from the App Group's live state revision and from a release
    // this process shares. A payload that is inside its horizon but describes
    // state the user has since changed is precisely what a timestamp cannot
    // catch, and it is the case that shows a wrong number on the face.
    let storedIsCurrent: Bool = {
        guard let stored,
            let timeline = stored.widgets[kind]?[familyKey(family)]
        else { return false }
        let revision = CoordinatedCounterStore(
            appGroupId: appGroupId,
            subdirectory: StateRevisionTracker.subdirectory)
        return WidgetSnapshot.freshness(
            entryDates: timeline.entries.map(\.entryDate),
            reloadAfter: timeline.reloadAfterDate,
            publishedAt: Date(timeIntervalSince1970: stored.publishedAt / 1000),
            now: Date(),
            payloadRevision: stored.stateRevision,
            currentRevision: revision.value(forKey: StateRevisionTracker.key),
            payloadReleaseId: stored.releaseId,
            runningReleaseId: sharedStore.widgetReleaseId()
        ) == .current
    }()
    let fresh =
        storedIsCurrent
        ? nil : WidgetIntentRuntime.renderFreshTimelines(appGroupId: appGroupId)
    // Rejecting a payload means "don't display it WITHOUT recomputing", never
    // "blank the complication": if the fresh render fails (nil), the stored
    // payload is still shown. An approximate face beats an empty one, and a
    // foreign-release payload is still this app's data.
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
    // Same revision-ordered selection the timeline path uses (ARCH-06), so a
    // snapshot arriving mid-burst can't prefer the stored payload over the
    // newer one this process just rendered — but still no fresh render here.
    let payload = WidgetSnapshot.newestPayload(
        SharedWidgetStore(appGroupId: appGroupId).loadPublishedWidgets(),
        WidgetIntentRuntime.cachedPayload(appGroupId: appGroupId))
    guard
        let entries = payload?.widgets[kind]?[familyKey(family)]?.entries,
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

/// What a React-published `ControlWidgetButton` should show: its label, its SF
/// Symbol, and the `actionLabel` WidgetKit displays while the action runs. The
/// visual is an OS template; React owns only the metadata. nil when nothing's
/// published for `intent`, so the consumer can supply a static default.
public func reactControlMetadata(
    _ intent: String, appGroupId: String
) -> (label: String, systemName: String?, actionLabel: String?)? {
    reactControlMetadata(intent, in: reactPublishedWidgets(appGroupId: appGroupId))
}

/// Payload-accepting variant — reuse one decoded payload across lookups.
public func reactControlMetadata(
    _ intent: String, in payload: PublishedWidgets?
) -> (label: String, systemName: String?, actionLabel: String?)? {
    guard let control = payload?.controls?[intent] else { return nil }
    return (control.label, control.systemName, control.actionLabel)
}

/// What a React-published `ControlWidgetToggle` should show: its label, its SF
/// Symbol, and the CURRENT on/off state.
///
/// nil unless JS actually published a `value` for `intent` — a control with no
/// published state is a button, and a toggle whose `isOn` nobody owns would
/// render as permanently-off chrome the user can fight with. A consumer hitting
/// nil should fall back to a static default or omit the control, exactly as
/// with `reactControlMetadata`.
///
/// Button-vs-toggle is still the CONSUMER's choice: the two are different
/// SwiftUI types in the `@main` bundle, so `value` supplies a declared toggle's
/// state rather than switching a button into one (see `registerControl`).
public func reactControlToggle(
    _ intent: String, appGroupId: String
) -> (label: String, systemName: String?, value: Bool)? {
    reactControlToggle(intent, in: reactPublishedWidgets(appGroupId: appGroupId))
}

/// Payload-accepting variant — reuse one decoded payload across lookups.
public func reactControlToggle(
    _ intent: String, in payload: PublishedWidgets?
) -> (label: String, systemName: String?, value: Bool)? {
    guard let control = payload?.controls?[intent], let value = control.value
    else { return nil }
    return (control.label, control.systemName, value)
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

/// Maps one React-published Smart Stack clue to a RelevanceKit context. The
/// wire shape is a tagged union, so this switches on `kind` rather than
/// guessing a family from which fields happen to be present. Used by the static
/// (Void) provider and a consumer's configurable (intent) provider (CX-017).
///
/// **Availability is per-arm** — the `AddGlassControl` pattern, gates rather
/// than a deployment-floor raise. `poi`, `dateRange` and any explicit
/// `dateKind` are watchOS 26.0 and return nil below it; the other six families
/// are watchOS 10.0, i.e. free at this package's floor.
///
/// Two deliberate "return nil" choices:
/// - An explicit `dateKind` below watchOS 26 DROPS the clue instead of falling
///   back to the kind-less `date(_:)`. `.informational` means "this is not a
///   scheduled moment"; degrading it to a plain date would surface the widget
///   for a clue whose author asked for the opposite.
/// - An unrecognized `kind`, `dateKind`, `category`, `place` or `condition` —
///   a bundle newer than this binary — drops that clue and keeps the rest.
///   Same forward-compat posture as the node interpreters' `default:`.
///
/// `dateRange` has no sub-26 path at all: `date(range:kind:)` is watchOS 26.0
/// and the older `date(from:to:)` is deprecated AT 26.0, so there is nothing
/// below it to fall back to.
@available(watchOS 11.0, *)
public func reactRelevantContext(
    from ctx: PublishedRelevantContext
) -> RelevantContext? {
    switch ctx.kind {
    case "date":
        guard let ms = ctx.date else { return nil }
        let exact = Date(timeIntervalSince1970: ms / 1000)
        guard let kindName = ctx.dateKind else { return .date(exact) }
        if #available(watchOS 26.0, *) {
            if let kind = reactRelevantDateKind(kindName) {
                return .date(exact, kind: kind)
            }
        }
        return nil

    case "dateRange":
        guard let from = ctx.from, let to = ctx.to, from <= to else {
            return nil
        }
        if #available(watchOS 26.0, *) {
            let start = Date(timeIntervalSince1970: from / 1000)
            let end = Date(timeIntervalSince1970: to / 1000)
            // An ABSENT dateKind defaults (`date(range:kind:)` has no kindless
            // overload to fall back to); an UNRECOGNIZED one drops the clue,
            // exactly as the `date` arm does. A kind this binary can't name is
            // not a kind it may silently substitute `.default` for.
            guard let name = ctx.dateKind else {
                return .date(range: start...end, kind: .default)
            }
            guard let kind = reactRelevantDateKind(name) else { return nil }
            return .date(range: start...end, kind: kind)
        }
        return nil

    case "location":
        guard let lat = ctx.latitude, let lon = ctx.longitude else {
            return nil
        }
        // CLCircularRegion is deprecated at watchOS 27.0 in favor of
        // CLCircularGeographicCondition — which has NO watchOS availability,
        // and RelevantContext.location(_:) still takes a CLRegion. Recorded,
        // not acted on: there is no successor to migrate to yet (see the
        // decline note in the merged backlog).
        return .location(
            CLCircularRegion(
                center: CLLocationCoordinate2D(latitude: lat, longitude: lon),
                radius: ctx.radius ?? 100,
                identifier: "react-relevance-\(lat),\(lon)"
            )
        )

    case "poi":
        guard let name = ctx.category else { return nil }
        if #available(watchOS 26.0, *) {
            if let category = reactPoiCategory(name) {
                // The only overload that itself returns an Optional — the
                // system can refuse a category outright.
                return .location(category: category)
            }
        }
        return nil

    case "inferredLocation":
        guard let place = ctx.place else { return nil }
        switch place {
        case "home": return .location(inferred: .home)
        case "work": return .location(inferred: .work)
        case "school": return .location(inferred: .school)
        case "commute": return .location(inferred: .commute)
        default: return nil
        }

    case "fitness":
        switch ctx.condition {
        case "activityRingsIncomplete": return .fitness(.activityRingsIncomplete)
        case "workoutActive": return .fitness(.workoutActive)
        default: return nil
        }

    case "sleep":
        switch ctx.condition {
        case "bedtime": return .sleep(.bedtime)
        case "wakeup": return .sleep(.wakeup)
        default: return nil
        }

    case "headphones":
        switch ctx.condition {
        case "connected": return .hardware(headphones: .connected)
        default: return nil
        }

    default:
        return nil
    }
}

/// RelevanceKit `DateKind` (watchOS 26.0) from its wire case name.
@available(watchOS 26.0, *)
private func reactRelevantDateKind(_ name: String) -> RelevantContext.DateKind? {
    switch name {
    case "default": .default
    case "informational": .informational
    case "scheduled": .scheduled
    default: nil
    }
}

/// `MKPointOfInterestCategory` from its Swift MEMBER NAME (not its rawValue —
/// that is an undocumented Objective-C constant, so a rawValue round-trip would
/// silently build a category that matches nothing). 73 members; MapKit's 11
/// "Type Properties" additions (`airportTerminal`, `scenicView`, …) are watchOS
/// 27.0 beta and are deliberately absent — naming a symbol the current SDK
/// can't compile is the CX-002/FoundationModels mistake. Gated at 26.0 because
/// that is the only caller; four members are themselves watchOS 11.0.
@available(watchOS 26.0, *)
private func reactPoiCategory(_ name: String) -> MKPointOfInterestCategory? {
    switch name {
    // Arts and culture
    case "museum": .museum
    case "musicVenue": .musicVenue
    case "theater": .theater
    // Education
    case "library": .library
    case "planetarium": .planetarium
    case "school": .school
    case "university": .university
    // Entertainment
    case "movieTheater": .movieTheater
    case "nightlife": .nightlife
    // Health and safety
    case "fireStation": .fireStation
    case "hospital": .hospital
    case "pharmacy": .pharmacy
    case "police": .police
    // Historical and cultural landmarks
    case "castle": .castle
    case "fortress": .fortress
    case "landmark": .landmark
    case "nationalMonument": .nationalMonument
    // Food and drink
    case "bakery": .bakery
    case "brewery": .brewery
    case "cafe": .cafe
    case "distillery": .distillery
    case "foodMarket": .foodMarket
    case "restaurant": .restaurant
    case "winery": .winery
    // Personal services
    case "animalService": .animalService
    case "atm": .atm
    case "automotiveRepair": .automotiveRepair
    case "bank": .bank
    case "beauty": .beauty
    case "evCharger": .evCharger
    case "fitnessCenter": .fitnessCenter
    case "laundry": .laundry
    case "mailbox": .mailbox
    case "postOffice": .postOffice
    case "restroom": .restroom
    case "spa": .spa
    case "store": .store
    // Parks and recreation
    case "amusementPark": .amusementPark
    case "aquarium": .aquarium
    case "beach": .beach
    case "campground": .campground
    case "fairground": .fairground
    case "marina": .marina
    case "nationalPark": .nationalPark
    case "park": .park
    case "rvPark": .rvPark
    case "zoo": .zoo
    // Sports
    case "baseball": .baseball
    case "basketball": .basketball
    case "bowling": .bowling
    case "goKart": .goKart
    case "golf": .golf
    case "hiking": .hiking
    case "miniGolf": .miniGolf
    case "rockClimbing": .rockClimbing
    case "skatePark": .skatePark
    case "skating": .skating
    case "skiing": .skiing
    case "soccer": .soccer
    case "stadium": .stadium
    case "tennis": .tennis
    case "volleyball": .volleyball
    // Travel
    case "airport": .airport
    case "carRental": .carRental
    case "conventionCenter": .conventionCenter
    case "gasStation": .gasStation
    case "hotel": .hotel
    case "parking": .parking
    case "publicTransport": .publicTransport
    // Water sports
    case "fishing": .fishing
    case "kayaking": .kayaking
    case "surfing": .surfing
    case "swimming": .swimming
    default: nil
    }
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
