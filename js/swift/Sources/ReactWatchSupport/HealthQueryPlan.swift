import Foundation

/// The HealthKit read vocabulary + request validation for js/src/health.ts.
///
/// Everything here is Foundation-only on purpose (the NotificationPlan /
/// UpdatePlan precedent): the actual queries live in an `#if os(watchOS)`
/// bridge that no Linux job can compile, so every rule a wrong request has to
/// trip — the unit table, the statistic/type legality Apple enforces by
/// THROWING, the window validation, the limit clamp — is decided here and
/// unit-tested under `swift test`.

/// Why a health request was rejected. The message is what JS sees as the
/// INVALID_REQUEST reason, so it names the rule that failed and the legal
/// values — a caller cannot read Apple's per-type statistics matrix from a bare
/// "bad request".
public struct HealthRequestError: Error, Equatable, Sendable,
    CustomStringConvertible
{
    public let message: String
    public init(_ message: String) { self.message = message }
    public var description: String { message }
}

/// `.failure` with the message wrapped, so each rule below reads as one line.
private func invalid<T>(_ message: String) -> Result<T, HealthRequestError> {
    .failure(HealthRequestError(message))
}

/// One quantity type the bridge reads, with the unit it is reported in.
///
/// The unit is fixed NATIVELY and never chosen by JS: a unit string on the wire
/// is a drift surface with no gate. The response reports it back so a caller can
/// label a chart. Keep the case list in sync with `healthQuantityTypes` in
/// js/codegen/schema.ts — `codegen.test.ts` pins the two against each other.
public enum HealthQuantityKind: String, CaseIterable, Sendable {
    case stepCount
    case activeEnergyBurned
    case distanceWalkingRunning
    case heartRate
    case oxygenSaturation
    case heartRateVariabilitySDNN
    case restingHeartRate
    case appleExerciseTime
    case basalEnergyBurned
    case respiratoryRate
    case flightsClimbed
    case vo2Max
    case walkingHeartRateAverage
    case appleStandTime

    /// Whether HealthKit treats this as a CUMULATIVE quantity (summable over a
    /// window) rather than a DISCRETE one (sampled). This is the axis that
    /// decides which `HKStatisticsOptions` are legal — see
    /// `HealthStatistic.isLegal(for:)`.
    public var isCumulative: Bool {
        switch self {
        case .stepCount, .activeEnergyBurned, .distanceWalkingRunning,
            .appleExerciseTime, .basalEnergyBurned, .flightsClimbed,
            .appleStandTime:
            true
        case .heartRate, .oxygenSaturation, .heartRateVariabilitySDNN,
            .restingHeartRate, .respiratoryRate, .vo2Max,
            .walkingHeartRateAverage:
            false
        }
    }

    /// The wire unit string, matching the `HKUnit` the bridge reads with.
    /// `oxygenSaturation` is `"fraction"`, not `"percent"`: `HKUnit.percent()`
    /// yields 0…1, and naming it `percent` is how a caller ends up multiplying
    /// by 100 twice. `heartRateVariabilitySDNN` is `"ms"`, never seconds: SDNN
    /// runs in the tens of milliseconds, so reading it in seconds reports
    /// `0.045` where the Health app shows `45`.
    ///
    /// `vo2Max` is the third of that family and the least obvious: it is a
    /// COMPOUND volume/mass/time unit, so a plausible-looking `HKUnit.liter()
    /// .unitDivided(by:…)` type-checks and ships a number 1000× off — Apple
    /// states the watch estimates the 14-60 range, so a slipped prefix reports
    /// `0.045`-style nonsense under a label that still says the right thing.
    /// The label is Apple's OWN spelling for this sample type: its `HKUnit`
    /// string table and the Health app both say `ml/kg/min`, so a chart axis
    /// reads like the app the number came from. Nothing parses the wire string
    /// back (the Host COMPOSES the unit instead), which is just as well — the
    /// `HKUnit(from:)` grammar page allows only ONE division symbol, a rule
    /// that same page's own table entry breaks, and mentions no parentheses at
    /// all, so there is no spelling that satisfies both.
    public var unit: String {
        switch self {
        case .stepCount: "count"
        case .activeEnergyBurned: "kcal"
        case .distanceWalkingRunning: "m"
        case .heartRate: "count/min"
        case .oxygenSaturation: "fraction"
        case .heartRateVariabilitySDNN: "ms"
        case .restingHeartRate: "count/min"
        case .appleExerciseTime: "min"
        case .basalEnergyBurned: "kcal"
        case .respiratoryRate: "count/min"
        case .flightsClimbed: "count"
        case .vo2Max: "ml/kg/min"
        case .walkingHeartRateAverage: "count/min"
        case .appleStandTime: "min"
        }
    }
}

/// The statistic a `queryHealthStatistics` may ask for — a closed union rather
/// than the raw `HKStatisticsOptions` bitmask.
///
/// `HKStatisticsOptions` is an OptionSet whose cumulative and discrete halves
/// are mutually exclusive per type: a cumulative type accepts only
/// `.cumulativeSum`, a discrete one only the `discrete*` family, and the wrong
/// pairing throws at query time. Exposing the bitmask would make an unlearnable
/// API whose failure mode is a native throw; naming the five and rejecting the
/// illegal pairing up front is the same rule applied by code instead.
/// Keep in sync with the `statistic` union in js/codegen/schema.ts.
public enum HealthStatistic: String, CaseIterable, Sendable {
    case sum
    case average
    case min
    case max
    case mostRecent

    /// `.sum` is legal only for a cumulative type; the other four only for a
    /// discrete one.
    ///
    /// The second half is THIS package's rule, not HealthKit's. Apple documents
    /// `.mostRecent` as an option of its own — "the system returns the most
    /// recent quantity from the matching samples" — outside the `discrete*`
    /// family, and states only that a discrete option cannot be COMBINED with a
    /// cumulative one; it nowhere says `.mostRecent` is refused for a
    /// cumulative type. Narrowing to one aggregate family per type is the
    /// promise we can keep without a device to check the wider one on: a chart
    /// can never ask for a scalar HealthKit may decline to compute.
    public func isLegal(for kind: HealthQuantityKind) -> Bool {
        self == .sum ? kind.isCumulative : !kind.isCumulative
    }
}

/// A sleep interval's stage — `HKCategoryValueSleepAnalysis` on the wire.
/// `.inBed` is watchOS 2.0, `.awake` 3.0 and the four `asleep*` cases 9.0, so
/// all six are below the package's v10 floor and ship ungated. Keep in sync
/// with the `stage` union in js/codegen/schema.ts.
public enum SleepStage: String, CaseIterable, Sendable {
    case inBed
    case awake
    case asleepCore
    case asleepDeep
    case asleepREM
    case asleepUnspecified
}

/// Which quantity the MOVE ring measures — `HKActivityMoveMode` (watchOS 7.0,
/// both cases, so ungated at the v10 floor like every vocabulary in this file).
///
/// Reported rather than assumed, because assuming is wrong for a whole class of
/// users: an under-18 account — and anyone who picked Move Time in Settings —
/// closes a MINUTES ring, and the calorie numbers on the same summary are not
/// what their watch scored them against. A renderer that always drew energy
/// would draw those users a ring that never fills while their watch says it
/// closed. Keep in sync with the `moveMode` union in js/codegen/schema.ts
/// (codegen.test.ts pins the two).
public enum ActivityMoveMode: String, CaseIterable, Sendable {
    case activeEnergy
    case appleMoveTime
}

/// The `{startMs, endMs, limit?}` window every health read carries, validated.
public struct HealthWindow: Equatable, Sendable {
    public let startMs: Double
    public let endMs: Double
    /// Clamped to 1...`maxLimit`; nil = "no cap the caller asked for", which
    /// every query in the bridge turns into `maxLimit` — NOT into HealthKit's
    /// unlimited sentinel (`HKObjectQueryNoLimit`), which a watch cannot afford
    /// (see `maxLimit`). Omitting `limit` therefore still truncates, which
    /// `WorkoutHistoryQuery.limit`'s JSDoc states for the query most likely to
    /// be asked for a whole year at once.
    public let limit: Int?

    public var start: Date { Date(timeIntervalSince1970: startMs / 1000) }
    public var end: Date { Date(timeIntervalSince1970: endMs / 1000) }

    /// Ceiling on a sample query. A watch has a few MB of headroom and every
    /// sample crosses the bridge as JSON, so an un-capped "give me a year of
    /// heart rate" is an out-of-memory kill, not a slow query.
    public static let maxLimit = 1000

    /// Ceiling on the buckets one daily-collection query may return — the same
    /// number as `maxLimit`, on purpose: a bucket costs the wire exactly what a
    /// sample does, so there is ONE ceiling here, not two rules a caller has to
    /// learn. Unlike `limit` this is not clamped but REFUSED (rule 12): a
    /// silently truncated series is a chart that lies about the range it was
    /// asked for, where a rejection names the window that was too wide.
    public static var maxDailyBuckets: Int { maxLimit }

    /// Whole days this window spans, rounded UP. Deliberately arithmetic rather
    /// than calendar: this feeds a CEILING check, and a 23- or 25-hour DST day
    /// cannot move a 1000-day window under the bar — while a `Calendar` here
    /// would make the refusal depend on the device's time zone.
    public var dayCount: Int {
        let days = ((endMs - startMs) / 86_400_000).rounded(.up)
        // SATURATES rather than converts blind. `decode` only promises the two
        // ends are finite and ordered, so JS can hand over a `Number.MAX_VALUE`
        // window whose day count is past `Int.max` — and two finite ends can
        // even subtract to `+inf`. `Int(_:)` TRAPS on both, which would abort
        // the app on the invoke dispatch path instead of letting the ceiling
        // below refuse the window like every other rule in this file does.
        guard days < Double(Int.max) else { return .max }
        return Int(days)
    }

    /// Whether a bucket that STARTS at `bucketStartMs` belongs to this window.
    ///
    /// `HKStatisticsCollection.enumerateStatistics(from:to:)` calls its block
    /// once per interval "between the start and end dates", and Apple documents
    /// the final one as "the time interval that CONTAINS the end date" — so a
    /// window ending exactly on a bucket boundary, which every
    /// `[midnight, midnight + 7d)` week chart is, yields an eighth bucket
    /// starting at `endMs`. Dropping it here is what makes "seven days in,
    /// seven buckets out" true.
    public func containsBucketStart(_ bucketStartMs: Double) -> Bool {
        bucketStartMs >= startMs && bucketStartMs < endMs
    }

    /// nil (with a reason) when the window is unusable. `endMs > startMs` is
    /// required rather than tolerated: an inverted or empty range resolves an
    /// empty result that a caller cannot tell from "no data", which is the one
    /// answer this API must not fake.
    public static func decode(
        startMs: Double?, endMs: Double?, limit: Int?
    ) -> Result<HealthWindow, HealthRequestError> {
        guard let startMs, startMs.isFinite, let endMs, endMs.isFinite else {
            return invalid("startMs and endMs are required, finite ms since epoch")
        }
        guard endMs > startMs else {
            return invalid("endMs (\(endMs)) must be after startMs (\(startMs))")
        }
        if let limit, limit <= 0 {
            return invalid("limit must be a positive sample count")
        }
        return .success(
            HealthWindow(
                startMs: startMs, endMs: endMs,
                limit: limit.map { Swift.min($0, maxLimit) }))
    }
}

/// A validated `queryHealthStatistics` request.
public struct HealthStatisticsPlan: Equatable, Sendable {
    public let kind: HealthQuantityKind
    public let statistic: HealthStatistic
    public let window: HealthWindow

    private struct Payload: Decodable {
        let type: String?
        let statistic: String?
        let startMs: Double?
        let endMs: Double?
    }

    public static func decode(json: String) -> Result<HealthStatisticsPlan, HealthRequestError> {
        guard
            let payload = try? JSONDecoder().decode(
                Payload.self, from: Data(json.utf8))
        else { return invalid("queryHealthStatistics needs a JSON object") }
        guard let kind = payload.type.flatMap(HealthQuantityKind.init(rawValue:))
        else {
            return invalid(
                "unknown health type '\(payload.type ?? "")' — expected one of "
                    + HealthQuantityKind.allCases.map(\.rawValue).joined(separator: ", "))
        }
        guard let statistic = payload.statistic.flatMap(HealthStatistic.init(rawValue:))
        else {
            return invalid(
                "unknown statistic '\(payload.statistic ?? "")' — expected one of "
                    + HealthStatistic.allCases.map(\.rawValue).joined(separator: ", "))
        }
        guard statistic.isLegal(for: kind) else {
            return invalid(
                "statistic '\(statistic.rawValue)' is not valid for "
                    + "'\(kind.rawValue)': a cumulative type takes only 'sum', "
                    + "a discrete one only average/min/max/mostRecent")
        }
        return HealthWindow.decode(
            startMs: payload.startMs, endMs: payload.endMs, limit: nil
        )
        .map {
            HealthStatisticsPlan(kind: kind, statistic: statistic, window: $0)
        }
    }

    /// The same request, for the BUCKETED query — one aggregate per day rather
    /// than one over the whole window. Every rule above still applies (the
    /// statistic/type legality Apple enforces by throwing does not change
    /// because the window is chopped up), plus the one rule only this query
    /// has: a bound on how many buckets come back.
    public static func decodeDaily(
        json: String
    ) -> Result<HealthStatisticsPlan, HealthRequestError> {
        decode(json: json).flatMap { plan in
            guard plan.window.dayCount <= HealthWindow.maxDailyBuckets else {
                return invalid(
                    "queryHealthDailyStatistics spans \(plan.window.dayCount) days, "
                        + "over the \(HealthWindow.maxDailyBuckets)-bucket ceiling — "
                        + "ask for a narrower window rather than a truncated series")
            }
            return .success(plan)
        }
    }
}

/// A validated `queryHealthSamples` request.
public struct HealthSamplesPlan: Equatable, Sendable {
    public let kind: HealthQuantityKind
    public let window: HealthWindow

    private struct Payload: Decodable {
        let type: String?
        let startMs: Double?
        let endMs: Double?
        let limit: Int?
    }

    public static func decode(json: String) -> Result<HealthSamplesPlan, HealthRequestError> {
        guard
            let payload = try? JSONDecoder().decode(
                Payload.self, from: Data(json.utf8))
        else { return invalid("queryHealthSamples needs a JSON object") }
        guard let kind = payload.type.flatMap(HealthQuantityKind.init(rawValue:))
        else {
            return invalid(
                "unknown health type '\(payload.type ?? "")' — expected one of "
                    + HealthQuantityKind.allCases.map(\.rawValue).joined(separator: ", "))
        }
        return HealthWindow.decode(
            startMs: payload.startMs, endMs: payload.endMs, limit: payload.limit
        )
        .map { HealthSamplesPlan(kind: kind, window: $0) }
    }
}

/// A validated `querySleepSamples` request — no type, because sleep is the one
/// CATEGORY read and jamming it into the numeric shape would produce `value: 3`
/// plus a magic mapping every caller would have to own.
public struct SleepSamplesPlan: Equatable, Sendable {
    public let window: HealthWindow

    private struct Payload: Decodable {
        let startMs: Double?
        let endMs: Double?
        let limit: Int?
    }

    public static func decode(json: String) -> Result<SleepSamplesPlan, HealthRequestError> {
        guard
            let payload = try? JSONDecoder().decode(
                Payload.self, from: Data(json.utf8))
        else { return invalid("querySleepSamples needs a JSON object") }
        return HealthWindow.decode(
            startMs: payload.startMs, endMs: payload.endMs, limit: payload.limit
        )
        .map { SleepSamplesPlan(window: $0) }
    }
}

/// A validated `queryWorkoutHistory` request — a window and a cap, and no type
/// at all: the thing being read IS the workout, not a measurement of one.
///
/// Not folded into `SleepSamplesPlan` despite the identical fields. The two
/// decode DIFFERENT methods, and the message a bad request comes back with
/// names the method the caller actually called — which is the whole reason
/// these messages exist (rule: name the rule and the legal values, not "bad
/// request"). They also grow apart: sleep's next field is a stage filter,
/// this one's is an activity filter.
public struct WorkoutHistoryPlan: Equatable, Sendable {
    public let window: HealthWindow

    private struct Payload: Decodable {
        let startMs: Double?
        let endMs: Double?
        let limit: Int?
    }

    public static func decode(json: String) -> Result<WorkoutHistoryPlan, HealthRequestError> {
        guard
            let payload = try? JSONDecoder().decode(
                Payload.self, from: Data(json.utf8))
        else { return invalid("queryWorkoutHistory needs a JSON object") }
        return HealthWindow.decode(
            startMs: payload.startMs, endMs: payload.endMs, limit: payload.limit
        )
        .map { WorkoutHistoryPlan(window: $0) }
    }
}

/// One calendar DAY — how HealthKit identifies an activity summary, and the one
/// window in this file that is not a pair of instants.
///
/// The reason is Apple's own: the activity-summary predicate takes
/// `DateComponents` that "uniquely identify the day as perceived by the user",
/// and that day "may be longer or shorter than 24 hours (for example, if the
/// user traveled across time zones)". No epoch millisecond means such a day on
/// its own — somebody has to pick a calendar and a zone to turn one into the
/// other — so the wire carries `"YYYY-MM-DD"` and nobody converts anything.
public struct ActivityDay: Equatable, Sendable {
    public let year: Int
    public let month: Int
    public let day: Int

    public init(year: Int, month: Int, day: Int) {
        self.year = year
        self.month = month
        self.day = day
    }

    /// THE calendar this feature uses, for both directions: building the query's
    /// components and reading a returned summary's day back out
    /// (`HKActivitySummary.dateComponents(for:)` takes one too). One
    /// definition, so the two cannot disagree about what day it is.
    ///
    /// Gregorian by identifier, never `Calendar.current`: `current` follows the
    /// user's chosen CALENDAR, and on a Buddhist or Japanese-era one the day
    /// would read back as year 2569 or 8 and format into a date string nothing
    /// could plot. The zone stays the system's (that is what
    /// `Calendar(identifier:)` gives), which is right and load-bearing: where
    /// the user is, is what decides where their day starts.
    ///
    /// COMPUTED, not a stored `let`, for that last sentence: a stored constant
    /// would capture `TimeZone.current` at first use and keep it for the life of
    /// the process, so a user who flies across zones mid-session would have
    /// their days labelled by where they took off from — the exact case Apple's
    /// own doc raises ("if the user traveled across time zones"). Building one
    /// is cheap; the bridge still binds it to a local so a thousand-row answer
    /// reads back through ONE calendar.
    public static var calendar: Calendar { Calendar(identifier: .gregorian) }

    /// The `DateComponents` the activity-summary predicate takes — and the ONLY
    /// place they are built.
    ///
    /// `calendar` is attached here, by construction, because Apple's parameter
    /// doc requires it ("the date components must have a valid calendar
    /// property") and the failure mode is silent: a set without one matches
    /// NOTHING, which reaches the caller as an empty array indistinguishable
    /// from "you have no rings" — no throw, no error, no row. Building them in
    /// the watchOS bridge would put that invariant somewhere Linux cannot test;
    /// here `SupportTests` proves it, and `health-package-guards.test.ts` pins
    /// that the bridge assembles no components of its own.
    public var components: DateComponents {
        var components = DateComponents()
        components.calendar = Self.calendar
        components.year = year
        components.month = month
        components.day = day
        return components
    }

    /// `"YYYY-MM-DD"`, zero-padded — the wire spelling, and sortable as text.
    public var iso: String {
        String(format: "%04d-%02d-%02d", year, month, day)
    }

    /// Days since 1970-01-01 by proleptic-Gregorian arithmetic — Howard
    /// Hinnant's `days_from_civil`, the algorithm C++'s `<chrono>` civil
    /// calendar is built on, taken rather than hand-rolled because its edge
    /// cases (century leap rules, negative years) are the ones a hand-rolled
    /// version gets wrong.
    ///
    /// Arithmetic and not a `Calendar`, for the reason `HealthWindow.dayCount`
    /// already gives: this feeds a CEILING check, and going through a calendar
    /// would make the refusal depend on where the watch is — including the zones
    /// where local midnight does not exist on a DST day (Brazil's transitions
    /// were at midnight), where the date has no instant to count from at all.
    public var serial: Int {
        let shifted = month <= 2 ? year - 1 : year
        let era = (shifted >= 0 ? shifted : shifted - 399) / 400
        let yearOfEra = shifted - era * 400
        let dayOfYear = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1
        let dayOfEra = yearOfEra * 365 + yearOfEra / 4 - yearOfEra / 100 + dayOfYear
        return era * 146_097 + dayOfEra - 719_468
    }

    /// Whether this year/month/day names a day that EXISTS — by the same
    /// proleptic-Gregorian arithmetic `serial` uses, and deliberately NOT by
    /// `DateComponents.isValidDate`.
    ///
    /// `isValidDate` resolves the components to an instant through their
    /// calendar, and `Calendar(identifier:)` carries the system's ZONE — so it
    /// answers "does this day exist HERE", which is a different question. Some
    /// zones have skipped a whole calendar day when they moved across the date
    /// line: Pacific/Apia has no 2011-12-30 and Kiritimati no 1994-12-31, and
    /// there `isValidDate` is false for a perfectly well-formed date. The same
    /// request would then be INVALID_REQUEST on one watch and a valid empty
    /// answer on another, refused with a message telling the caller their
    /// FORMAT was wrong when it was not. `serial`'s doc already promises the
    /// refusals do not depend on where the watch is; this is the other half of
    /// that promise. The system zone stays where it belongs — on the components
    /// handed to HealthKit, where the user's zone IS the right answer.
    private var exists: Bool {
        guard (1...12).contains(month), day >= 1 else { return false }
        let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
        let lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
        return day <= lengths[month - 1]
    }

    /// `"YYYY-MM-DD"` — exactly ten characters, zero-padded, ASCII digits, and a
    /// day that exists.
    ///
    /// Strict on purpose: `"2026-8-9"` and `"2026-08-09T00:00:00Z"` are both
    /// refused rather than salvaged. The first does not sort as text, and the
    /// second is an INSTANT — the one thing this type exists to keep off the
    /// wire, since accepting it would smuggle back in the zone conversion whose
    /// off-by-one the shape was chosen to avoid.
    ///
    /// The existence check is `exists`, not `DateComponents.isValidDate` — see
    /// there for why a day's existence must not be asked of a calendar that
    /// carries a zone.
    public init?(iso text: String) {
        let parts = text.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 3, parts[0].count == 4, parts[1].count == 2,
            parts[2].count == 2,
            parts.allSatisfy({ $0.allSatisfy { $0.isASCII && $0.isNumber } }),
            let year = Int(parts[0]), let month = Int(parts[1]),
            let day = Int(parts[2])
        else { return nil }
        self.init(year: year, month: month, day: day)
        guard exists else { return nil }
    }

    /// The day a returned `HKActivitySummary` is FOR, from the components
    /// `dateComponents(for:)` hands back — the only door from HealthKit's answer
    /// to a wire date. nil when they carry no year/month/day or an impossible
    /// one, which makes the bridge DROP that row: a summary nothing can date is
    /// a bar a chart cannot place, and dropping is the same posture the sleep
    /// read takes for a category value this binary cannot name.
    public init?(components: DateComponents) {
        guard let year = components.year, let month = components.month,
            let day = components.day
        else { return nil }
        self.init(year: year, month: month, day: day)
        guard exists else { return nil }
    }
}

/// A validated `queryActivitySummaries` request — a range of DAYS, inclusive at
/// both ends, and no cap at all.
///
/// The two deviations from `HealthWindow` are both forced by what an activity
/// summary IS. It is keyed by a user-perceived day, so the ends are days
/// (`ActivityDay`) rather than instants. And the answer is one row per day, so
/// the RANGE is already the bound: a `limit` could only mean "drop some of the
/// days you asked for", which is a ring history with holes in it that the caller
/// cannot see. The size rule is therefore a ceiling on the range, refused rather
/// than clamped.
public struct ActivitySummariesPlan: Equatable, Sendable {
    public let start: ActivityDay
    public let end: ActivityDay

    public init(start: ActivityDay, end: ActivityDay) {
        self.start = start
        self.end = end
    }

    /// Days this request covers, both ends INCLUDED — `start == end` is one day,
    /// which is the "today's rings" ask a complication makes.
    public var dayCount: Int { end.serial - start.serial + 1 }

    /// Ceiling on the days one query may ask for — the same number as
    /// `HealthWindow.maxLimit`, deliberately: a summary row costs the wire about
    /// what a sample or a daily bucket does, so this family has ONE size rule
    /// rather than three a caller has to learn. It is also ~2.7 years, so every
    /// ring screen anyone actually builds (a day, a week, a month, a year) fits.
    ///
    /// REFUSED, not truncated — `maxDailyBuckets`' rule verbatim: a silently
    /// shortened history is a chart that lies about the range it was asked for,
    /// where a rejection names the range that was too wide.
    public static var maxDays: Int { HealthWindow.maxLimit }

    private struct Payload: Decodable {
        let startDate: String?
        let endDate: String?
    }

    public static func decode(json: String) -> Result<ActivitySummariesPlan, HealthRequestError> {
        guard
            let payload = try? JSONDecoder().decode(
                Payload.self, from: Data(json.utf8))
        else { return invalid("queryActivitySummaries needs a JSON object") }
        guard let start = payload.startDate.flatMap(ActivityDay.init(iso:)) else {
            return invalid(dayMessage(field: "startDate", got: payload.startDate))
        }
        guard let end = payload.endDate.flatMap(ActivityDay.init(iso:)) else {
            return invalid(dayMessage(field: "endDate", got: payload.endDate))
        }
        guard end.serial >= start.serial else {
            return invalid(
                "endDate (\(end.iso)) must be on or after startDate "
                    + "(\(start.iso)) — the range is INCLUSIVE, so one day is "
                    + "startDate == endDate")
        }
        let plan = ActivitySummariesPlan(start: start, end: end)
        guard plan.dayCount <= maxDays else {
            return invalid(
                "queryActivitySummaries spans \(plan.dayCount) days, over the "
                    + "\(maxDays)-day ceiling — ask for a narrower range rather "
                    + "than a truncated ring history")
        }
        return .success(plan)
    }

    private static func dayMessage(field: String, got: String?) -> String {
        "\(field) must be a calendar day 'YYYY-MM-DD' — the day the rings are "
            + "FOR, not a timestamp — got '\(got ?? "")'"
    }
}

/// The read types a `requestHealthAuthorization` asks for.
///
/// The result it reports is deliberately thin, because HealthKit gives nothing
/// thicker: Apple states an app "doesn't know whether someone granted or denied
/// permission to read data", and a denied read returns only samples the app
/// itself wrote. `getRequestStatusForAuthorization` ("would the sheet show") is
/// the only honest signal, so that is exactly what the wrapper reports.
public struct HealthAuthorizationPlan: Equatable, Sendable {
    public let kinds: [HealthQuantityKind]
    public let sleep: Bool
    /// Saved workouts (`HKObjectType.workoutType()`), which is neither a
    /// quantity nor a category type and so cannot ride the `read` list either.
    /// A read of the user's workout HISTORY — unrelated to the `workouts`
    /// feature next door, which authorizes RECORDING one.
    public let workoutHistory: Bool
    /// The Activity rings (`HKObjectType.activitySummaryType()`) — a third read
    /// that is neither a quantity nor a category type. Unlike `workoutHistory`
    /// this one asks for NOTHING else: a summary is a single object HealthKit
    /// hands over whole, goals included, not a total computed from samples that
    /// carry their own grants.
    public let activitySummaries: Bool

    private struct Payload: Decodable {
        let read: [String]?
        let sleep: Bool?
        let workoutHistory: Bool?
        let activitySummaries: Bool?
    }

    public static func decode(json: String) -> Result<HealthAuthorizationPlan, HealthRequestError> {
        guard
            let payload = try? JSONDecoder().decode(
                Payload.self, from: Data(json.utf8))
        else { return invalid("requestHealthAuthorization needs a JSON object") }
        var kinds: [HealthQuantityKind] = []
        for name in payload.read ?? [] {
            guard let kind = HealthQuantityKind(rawValue: name) else {
                return invalid("unknown health type '\(name)'")
            }
            kinds.append(kind)
        }
        let sleep = payload.sleep ?? false
        let workoutHistory = payload.workoutHistory ?? false
        let activitySummaries = payload.activitySummaries ?? false
        guard !kinds.isEmpty || sleep || workoutHistory || activitySummaries else {
            return invalid(
                "requestHealthAuthorization needs at least one read type "
                    + "(or sleep: true, workoutHistory: true, or "
                    + "activitySummaries: true)")
        }
        return .success(
            HealthAuthorizationPlan(
                kinds: kinds, sleep: sleep, workoutHistory: workoutHistory,
                activitySummaries: activitySummaries))
    }
}
