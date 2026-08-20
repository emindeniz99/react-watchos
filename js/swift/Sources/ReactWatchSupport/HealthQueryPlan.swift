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

/// The `{startMs, endMs, limit?}` window every health read carries, validated.
public struct HealthWindow: Equatable, Sendable {
    public let startMs: Double
    public let endMs: Double
    /// Clamped to 1...`maxLimit`; nil = "no cap the caller asked for", which
    /// the bridge turns into HealthKit's own unlimited sentinel.
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

    private struct Payload: Decodable {
        let read: [String]?
        let sleep: Bool?
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
        guard !kinds.isEmpty || sleep else {
            return invalid(
                "requestHealthAuthorization needs at least one read type "
                    + "(or sleep: true)")
        }
        return .success(HealthAuthorizationPlan(kinds: kinds, sleep: sleep))
    }
}
