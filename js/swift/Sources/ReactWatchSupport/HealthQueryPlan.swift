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

    /// Whether HealthKit treats this as a CUMULATIVE quantity (summable over a
    /// window) rather than a DISCRETE one (sampled). This is the axis that
    /// decides which `HKStatisticsOptions` are legal — see
    /// `HealthStatistic.isLegal(for:)`.
    public var isCumulative: Bool {
        switch self {
        case .stepCount, .activeEnergyBurned, .distanceWalkingRunning: true
        case .heartRate, .oxygenSaturation: false
        }
    }

    /// The wire unit string, matching the `HKUnit` the bridge reads with.
    /// `oxygenSaturation` is `"fraction"`, not `"percent"`: `HKUnit.percent()`
    /// yields 0…1, and naming it `percent` is how a caller ends up multiplying
    /// by 100 twice.
    public var unit: String {
        switch self {
        case .stepCount: "count"
        case .activeEnergyBurned: "kcal"
        case .distanceWalkingRunning: "m"
        case .heartRate: "count/min"
        case .oxygenSaturation: "fraction"
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
                    + "'\(kind.rawValue)': HealthKit accepts only 'sum' for a "
                    + "cumulative type and only average/min/max/mostRecent for a "
                    + "discrete one")
        }
        return HealthWindow.decode(
            startMs: payload.startMs, endMs: payload.endMs, limit: nil
        )
        .map {
            HealthStatisticsPlan(kind: kind, statistic: statistic, window: $0)
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
