import Foundation

/// One `CMPedometerData` reading as the wire's `PedometerData` — ONE shape on
/// both carriers, the `sensor.pedometer` push AND the `queryPedometer` invoke
/// response, because they describe the same thing at different times.
///
/// Foundation-only so the assembly rule (which fields are omitted, and the
/// units) is unit-tested on Linux; the CoreMotion side just maps
/// `CMPedometerData` onto this and calls `payload()`.
///
/// The units are IN the field names deliberately. Apple's `currentPace` is
/// **seconds per metre** and `currentCadence` is **steps per second** — both
/// counter-intuitive, both verified from the property abstracts — and a caller
/// who reads `pace` as min/km silently renders a wrong number.
public struct PedometerReading: Equatable, Sendable {
    public let startMs: Double
    public let endMs: Double
    public let steps: Double
    /// nil when `CMPedometer.isDistanceAvailable()` is false.
    public let distanceMeters: Double?
    /// nil when `CMPedometer.isFloorCountingAvailable()` is false.
    public let floorsAscended: Double?
    public let floorsDescended: Double?
    /// LIVE ONLY — Apple documents `currentPace`/`currentCadence` as nil on a
    /// historical query, so a historical reading omits them rather than
    /// reporting a stale live value.
    public let currentPaceSecPerMeter: Double?
    public let currentCadenceStepsPerSec: Double?
    public let averageActivePaceSecPerMeter: Double?

    public init(
        startMs: Double, endMs: Double, steps: Double,
        distanceMeters: Double? = nil, floorsAscended: Double? = nil,
        floorsDescended: Double? = nil, currentPaceSecPerMeter: Double? = nil,
        currentCadenceStepsPerSec: Double? = nil,
        averageActivePaceSecPerMeter: Double? = nil
    ) {
        self.startMs = startMs
        self.endMs = endMs
        self.steps = steps
        self.distanceMeters = distanceMeters
        self.floorsAscended = floorsAscended
        self.floorsDescended = floorsDescended
        self.currentPaceSecPerMeter = currentPaceSecPerMeter
        self.currentCadenceStepsPerSec = currentCadenceStepsPerSec
        self.averageActivePaceSecPerMeter = averageActivePaceSecPerMeter
    }

    /// The JSON-safe payload. Unavailable fields are OMITTED, never zero-filled:
    /// a `0` would lie about a watch with no altimeter (or about a historical
    /// query, which has no instantaneous pace) in a way the caller cannot
    /// distinguish from "you did not climb any stairs".
    public func payload() -> [String: Any] {
        var out: [String: Any] = [
            "startMs": startMs,
            "endMs": endMs,
            "steps": steps,
        ]
        if let distanceMeters { out["distanceMeters"] = distanceMeters }
        if let floorsAscended { out["floorsAscended"] = floorsAscended }
        if let floorsDescended { out["floorsDescended"] = floorsDescended }
        if let currentPaceSecPerMeter {
            out["currentPaceSecPerMeter"] = currentPaceSecPerMeter
        }
        if let currentCadenceStepsPerSec {
            out["currentCadenceStepsPerSec"] = currentCadenceStepsPerSec
        }
        if let averageActivePaceSecPerMeter {
            out["averageActivePaceSecPerMeter"] = averageActivePaceSecPerMeter
        }
        return out
    }
}

/// A validated `queryPedometer` request. CoreMotion keeps roughly the last
/// seven days of step history on the device, so a window outside that resolves
/// an honest zero rather than failing — but an INVERTED window is a caller bug
/// and is refused, for the same reason the health reads refuse one.
public struct PedometerQueryPlan: Equatable, Sendable {
    public let startMs: Double
    public let endMs: Double

    public var start: Date { Date(timeIntervalSince1970: startMs / 1000) }
    public var end: Date { Date(timeIntervalSince1970: endMs / 1000) }

    private struct Payload: Decodable {
        let startMs: Double?
        let endMs: Double?
    }

    public static func decode(json: String) -> Result<PedometerQueryPlan, HealthRequestError> {
        guard
            let payload = try? JSONDecoder().decode(
                Payload.self, from: Data(json.utf8))
        else {
            return .failure(HealthRequestError("queryPedometer needs a JSON object"))
        }
        guard let startMs = payload.startMs, startMs.isFinite,
            let endMs = payload.endMs, endMs.isFinite
        else {
            return .failure(
                HealthRequestError(
                    "queryPedometer needs finite startMs and endMs, ms since epoch"))
        }
        guard endMs > startMs else {
            return .failure(
                HealthRequestError(
                    "endMs (\(endMs)) must be after startMs (\(startMs))"))
        }
        return .success(PedometerQueryPlan(startMs: startMs, endMs: endMs))
    }
}
