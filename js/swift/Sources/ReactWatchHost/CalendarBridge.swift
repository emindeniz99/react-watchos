// EventKit READ queries for js/src/calendar.ts, routed through the invoke
// channel. watchOS-only like the rest of ReactWatchHost: the whole file
// compiles to nothing off-watchOS so `swift test` still runs on Linux — which
// is exactly why every rule a malformed request has to trip lives in
// ReactWatchSupport's CalendarPlan (Linux-tested) and this file only turns a
// VALIDATED plan into an EventKit query.
//
// Availability: `requestFullAccessToEvents(completion:)` /
// `requestFullAccessToReminders(completion:)` are watchOS 10.0 — exactly this
// package's floor — so nothing here needs an `@available` gate. The
// pre-10 `requestAccess(to:completion:)` is deprecated at 10.0 and is
// deliberately not used; project rule 1 (pre-release, prefer the clean shape)
// gives no compat argument for shipping it.
#if os(watchOS)
import EventKit
import Foundation
import ReactWatchSupport

/// One EventKit read bridge per model.
///
/// `@MainActor` deliberately (the `HealthQueryBridge` shape): the model that
/// owns it is `@MainActor` too, so there is no hop, and the mutable state is
/// safe without a lock.
///
/// The `EKEventStore` is a LONG-LIVED stored property, not a per-call
/// instance. Apple, `EKEventStore` Overview: "Releasing an event store
/// instance before other EventKit objects may result in an error" — a
/// per-call store would be released while the `EKEvent`s it vended are still
/// being read.
@MainActor final class CalendarBridge {
    /// Settled outcome of one read, already serialized — the
    /// `HealthQueryBridge.Outcome` shape plus the `denied` arm EventKit
    /// genuinely has and HealthKit does not (HealthKit refuses to tell an app
    /// whether a READ was granted; EventKit says so plainly).
    enum Outcome: Sendable {
        case ok(String)  // resultJson
        case denied(String)
        case error(String)
    }

    private let store = EKEventStore()

    /// `events(matching:)` is SYNCHRONOUS and can be slow (Apple says so), so
    /// it never runs on main. One serial queue for both reads: they are
    /// user-initiated and never hot, and a concurrent queue would only add
    /// EventKit contention.
    private static let queue = DispatchQueue(label: "react.watch.calendar")

    static func entityType(for entity: CalendarEntity) -> EKEntityType {
        switch entity {
        case .events: .event
        case .reminders: .reminder
        }
    }

    /// Maps `EKAuthorizationStatus` to the wire vocabulary.
    ///
    /// `.fullAccess` is the ONLY status that can read — Apple: "To read events
    /// or reminders from the event store, your app needs full access."
    /// `.authorized` is not a case here on purpose: it is the pre-17 spelling
    /// of the same raw value as `.fullAccess`, so naming both would be a
    /// duplicate case, not extra coverage.
    static func access(for status: EKAuthorizationStatus) -> CalendarAccess {
        switch status {
        case .notDetermined: .notDetermined
        case .restricted: .restricted
        case .denied: .denied
        case .fullAccess: .granted
        case .writeOnly: .writeOnly
        @unknown default: .unavailable
        }
    }

    static func status(for entity: CalendarEntity) -> CalendarAccess {
        access(for: EKEventStore.authorizationStatus(for: entityType(for: entity)))
    }

    // MARK: - Authorization

    /// Runs the TCC sheet for one entity and reports the resulting status.
    ///
    /// `requestFullAccess*` is what a READ needs despite this API being
    /// read-only — Apple exposes no read-only grant, and
    /// `requestWriteOnlyAccessToEvents` explicitly cannot read. Once the user
    /// has answered, the call returns the standing status without prompting
    /// again, so this doubles as the status read and v1 ships no separate
    /// `getCalendarAccessStatus`.
    ///
    /// The completion is ignored in favour of re-reading
    /// `authorizationStatus(for:)`: the Bool only says "did the request
    /// succeed", which is true for a DENIAL too.
    func requestAccess(_ plan: CalendarAccessPlan) async -> CalendarAccess {
        nonisolated(unsafe) let store = self.store
        let entity = plan.entity
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            switch entity {
            case .events:
                store.requestFullAccessToEvents { _, _ in continuation.resume() }
            case .reminders:
                store.requestFullAccessToReminders { _, _ in continuation.resume() }
            }
        }
        return Self.status(for: entity)
    }

    // MARK: - Reads

    /// Events overlapping the plan's window, earliest first.
    ///
    /// Nil-safety is not decoration here: `EKEvent.startDate`/`.endDate`,
    /// `EKCalendarItem.title` and `.calendar` are ObjC-imported as implicitly
    /// unwrapped optionals, so reading them straight into a declared
    /// non-optional wire field is how a crash — or a `null` the TS type says
    /// cannot happen — ships. An event with no `startDate` is DROPPED: it has
    /// no place on a timeline and a zero would put it at 1970.
    func events(_ plan: CalendarEventsPlan) async -> Outcome {
        let status = Self.status(for: .events)
        guard status.canRead else { return Self.refusal(status, "events") }
        nonisolated(unsafe) let store = self.store
        let start = plan.start
        let end = plan.end
        let limit = plan.limit ?? CalendarLimits.maxLimit
        return await withCheckedContinuation { continuation in
            Self.queue.async {
                let predicate = store.predicateForEvents(
                    withStart: start, end: end, calendars: nil)
                let matched = store.events(matching: predicate)
                    .sorted {
                        ($0.startDate ?? .distantPast) < ($1.startDate ?? .distantPast)
                    }
                    .prefix(limit)
                let payload = matched.compactMap { event -> [String: Any]? in
                    guard let startDate = event.startDate else { return nil }
                    var entry: [String: Any] = [
                        "id": event.eventIdentifier ?? "",
                        "title": event.title ?? "",
                        "startMs": startDate.timeIntervalSince1970 * 1000,
                        "endMs": (event.endDate ?? startDate).timeIntervalSince1970
                            * 1000,
                        "allDay": event.isAllDay,
                        "calendarTitle": event.calendar?.title ?? "",
                    ]
                    if let location = event.location, !location.isEmpty {
                        entry["location"] = location
                    }
                    return entry
                }
                continuation.resume(returning: .ok(Self.json(payload)))
            }
        }
    }

    /// Incomplete reminders due before the plan's cut-off, earliest first.
    /// `fetchReminders(matching:completion:)` is already asynchronous and its
    /// completion arrives off-main, so the payload is built there and only the
    /// finished JSON crosses back.
    func reminders(_ plan: RemindersPlan) async -> Outcome {
        let status = Self.status(for: .reminders)
        guard status.canRead else { return Self.refusal(status, "reminders") }
        nonisolated(unsafe) let store = self.store
        let dueBefore = plan.dueBefore
        let limit = plan.limit ?? CalendarLimits.maxLimit
        return await withCheckedContinuation { continuation in
            let predicate = store.predicateForIncompleteReminders(
                withDueDateStarting: nil, ending: dueBefore, calendars: nil)
            store.fetchReminders(matching: predicate) { reminders in
                let payload = (reminders ?? [])
                    .sorted {
                        (Self.due($0) ?? .distantFuture)
                            < (Self.due($1) ?? .distantFuture)
                    }
                    .prefix(limit)
                    .map { reminder -> [String: Any] in
                        var entry: [String: Any] = [
                            "id": reminder.calendarItemIdentifier,
                            "title": reminder.title ?? "",
                            "completed": reminder.isCompleted,
                            "calendarTitle": reminder.calendar?.title ?? "",
                        ]
                        if let due = Self.due(reminder) {
                            entry["dueMs"] = due.timeIntervalSince1970 * 1000
                        }
                        return entry
                    }
                continuation.resume(returning: .ok(Self.json(Array(payload))))
            }
        }
    }

    /// A reminder's due date. `dueDateComponents` is components, not a Date,
    /// and a reminder may legitimately have none — which is why `dueMs` is
    /// optional on the wire rather than zero-filled.
    private static func due(_ reminder: EKReminder) -> Date? {
        reminder.dueDateComponents.flatMap {
            Calendar.current.date(from: $0)
        }
    }

    /// Turns a non-readable status into the outcome the host rejects with.
    /// `denied` and `restricted` and `writeOnly` are the user's/OS's answer —
    /// Settings is the fix, re-prompting is not — while `notDetermined` means
    /// nobody has asked yet, which IS fixable by calling
    /// `requestCalendarAccess`. Both reject; the messages differ because the
    /// caller's next move does.
    private static func refusal(_ status: CalendarAccess, _ what: String) -> Outcome {
        switch status {
        case .notDetermined:
            .denied(
                "calendar access for \(what) has not been requested — call "
                    + "requestCalendarAccess({ entity: \"\(what)\" }) first")
        case .writeOnly:
            .denied(
                "this app has WRITE-ONLY access to \(what); reading needs full "
                    + "access — change it in Settings > Privacy")
        case .unavailable:
            .error("EventKit reported an authorization status this app cannot read")
        default:
            .denied(
                "access to \(what) is \(status.rawValue) — re-enable it for this "
                    + "app in Settings > Privacy")
        }
    }

    /// JSON for an already-JSON-safe array.
    ///
    /// `nonisolated`, and that is load-bearing: the class-level `@MainActor`
    /// would otherwise isolate this pure function too, and both call sites run
    /// OFF main — `events` on the calendar queue's `@Sendable` closure,
    /// `reminders` inside EventKit's off-main completion. Isolated, the
    /// `events` call would have to SEND its non-Sendable `payload` (a region
    /// the compiler merges with the captured store) onto the main actor, which
    /// Swift 6 rejects ("sending 'payload' risks causing data races").
    /// Nonisolated, the call stays in the caller's context and nothing crosses.
    private nonisolated static func json(_ value: [[String: Any]]) -> String {
        (try? JSONSerialization.data(withJSONObject: value))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
    }
}
#endif
