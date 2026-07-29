import Foundation

/// The EventKit read contract's decidable half (js/src/calendar.ts).
///
/// Foundation-only on purpose, the `HealthQueryPlan` precedent: the queries
/// live in an `#if os(watchOS)` bridge no Linux job can compile, so every rule
/// a malformed request has to trip — the entity vocabulary, the window rules,
/// the result cap — is decided here and unit-tested under `swift test`.

/// Why a calendar request was rejected. The message is what JS sees as the
/// INVALID_REQUEST reason, so it names the rule and the legal values.
public struct CalendarRequestError: Error, Equatable, Sendable,
    CustomStringConvertible
{
    public let message: String
    public init(_ message: String) { self.message = message }
    public var description: String { message }
}

private func invalid<T>(_ message: String) -> Result<T, CalendarRequestError> {
    .failure(CalendarRequestError(message))
}

/// Which EventKit entity a request is about. Closed, and mapped natively to
/// `EKEntityType`: an open string would type-check, prompt for nothing and
/// resolve empty forever (the `SensorKind` lesson).
public enum CalendarEntity: String, CaseIterable, Sendable {
    case events
    case reminders
}

/// The authorization verdict reported back to JS.
///
/// `writeOnly` is a REAL watchOS 10 state and is deliberately not collapsed
/// into `denied`: they mean opposite things to a user ("I said no" vs "you may
/// add, not read"), and collapsing them would make an app tell someone who
/// granted write-only that they refused. Neither can read, which is what the
/// caller acts on — but only one of them is worth re-prompting about.
public enum CalendarAccess: String, CaseIterable, Sendable {
    case granted
    case denied
    case restricted
    case notDetermined
    case writeOnly
    /// EventKit reported a status this binary does not know.
    case unavailable

    /// Whether a read can return anything. Apple, *Accessing the event store*:
    /// "Your app can't request read-only access to either events or reminders.
    /// To read events or reminders from the event store, your app needs full
    /// access." So exactly one status can read.
    public var canRead: Bool { self == .granted }
}

/// Shared limits for the two read ops.
public enum CalendarLimits {
    /// Ceiling on returned items. Every item crosses the bridge as JSON on a
    /// memory-tight watch, and a watch screen showing more than this is a
    /// design problem long before it is a memory one.
    public static let maxLimit = 250
    /// Default window for `getReminders` when the caller names no cut-off:
    /// "everything incomplete, ever" is an unbounded query.
    public static let defaultReminderWindow: TimeInterval = 30 * 24 * 60 * 60
}

/// A validated `requestCalendarAccess` request.
public struct CalendarAccessPlan: Equatable, Sendable {
    public let entity: CalendarEntity

    private struct Payload: Decodable {
        let entity: String?
    }

    public static func decode(json: String) -> Result<CalendarAccessPlan, CalendarRequestError> {
        guard
            let payload = try? JSONDecoder().decode(
                Payload.self, from: Data(json.utf8))
        else { return invalid("requestCalendarAccess needs a JSON object") }
        guard let entity = payload.entity.flatMap(CalendarEntity.init(rawValue:))
        else {
            return invalid(
                "unknown calendar entity '\(payload.entity ?? "")' — expected one of "
                    + CalendarEntity.allCases.map(\.rawValue).joined(separator: ", "))
        }
        return .success(CalendarAccessPlan(entity: entity))
    }
}

/// A validated `getCalendarEvents` request.
public struct CalendarEventsPlan: Equatable, Sendable {
    public let startMs: Double
    public let endMs: Double
    /// Clamped to 1...`CalendarLimits.maxLimit`; nil = the cap.
    public let limit: Int?

    public var start: Date { Date(timeIntervalSince1970: startMs / 1000) }
    public var end: Date { Date(timeIntervalSince1970: endMs / 1000) }

    private struct Payload: Decodable {
        let startMs: Double?
        let endMs: Double?
        let limit: Int?
    }

    public static func decode(json: String) -> Result<CalendarEventsPlan, CalendarRequestError> {
        guard
            let payload = try? JSONDecoder().decode(
                Payload.self, from: Data(json.utf8))
        else { return invalid("getCalendarEvents needs a JSON object") }
        guard let startMs = payload.startMs, startMs.isFinite,
            let endMs = payload.endMs, endMs.isFinite
        else {
            return invalid("startMs and endMs are required, finite ms since epoch")
        }
        // Required rather than tolerated, the HealthWindow rule: an inverted or
        // empty window resolves `[]`, which a caller cannot tell from "nothing
        // in your calendar" — the one answer this API must not fake.
        guard endMs > startMs else {
            return invalid("endMs (\(endMs)) must be after startMs (\(startMs))")
        }
        if let limit = payload.limit, limit <= 0 {
            return invalid("limit must be a positive event count")
        }
        return .success(
            CalendarEventsPlan(
                startMs: startMs, endMs: endMs,
                limit: payload.limit.map { Swift.min($0, CalendarLimits.maxLimit) }))
    }
}

/// A validated `getReminders` request. Both fields are optional, so an
/// argument-less call is legal and means "incomplete reminders due in the next
/// 30 days".
public struct RemindersPlan: Equatable, Sendable {
    public let dueBeforeMs: Double
    public let limit: Int?

    public var dueBefore: Date { Date(timeIntervalSince1970: dueBeforeMs / 1000) }

    private struct Payload: Decodable {
        let dueBeforeMs: Double?
        let limit: Int?
    }

    public static func decode(
        json: String, now: Date = Date()
    ) -> Result<RemindersPlan, CalendarRequestError> {
        // "" is what invoke sends for an argument-less call; `{}` is what an
        // empty options object serializes to. Both mean "use the defaults".
        let source = json.isEmpty ? "{}" : json
        guard
            let payload = try? JSONDecoder().decode(
                Payload.self, from: Data(source.utf8))
        else { return invalid("getReminders needs a JSON object") }
        if let dueBeforeMs = payload.dueBeforeMs, !dueBeforeMs.isFinite {
            return invalid("dueBeforeMs must be finite ms since epoch")
        }
        if let limit = payload.limit, limit <= 0 {
            return invalid("limit must be a positive reminder count")
        }
        let dueBeforeMs =
            payload.dueBeforeMs
            ?? (now.addingTimeInterval(CalendarLimits.defaultReminderWindow)
                .timeIntervalSince1970 * 1000)
        return .success(
            RemindersPlan(
                dueBeforeMs: dueBeforeMs,
                limit: payload.limit.map { Swift.min($0, CalendarLimits.maxLimit) }))
    }
}
