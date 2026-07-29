import Foundation

/// The workout-control request contract for js/src/workout.ts — the half that
/// is decidable without HealthKit, so it is decided here and unit-tested on
/// Linux (the session owner itself is `#if os(watchOS)` and unreachable under
/// `swift test`).
///
/// The activity NAME is deliberately NOT validated here: the only truthful
/// check is "does this binary's `HKWorkoutActivityType` have that case", and
/// that lives in the generated `WorkoutActivityName` switch on the watch side.
/// Re-listing 81 names here would be a second source of truth that could only
/// ever disagree with the generated one.

/// `HKWorkoutSessionLocationType`. Not cosmetic: Apple states outdoor cycling
/// generates accurate location data where indoor does not, and that calorimetry
/// differs by location — so this changes the numbers the workout records.
public enum WorkoutLocation: String, CaseIterable, Sendable {
    case indoor
    case outdoor
}

/// The wire spelling of `HKWorkoutSessionState`. Keep in sync with the `state`
/// union in js/codegen/schema.ts (codegen.test.ts pins the two).
public enum WorkoutStateName: String, CaseIterable, Sendable {
    case notStarted
    case running
    case paused
    case ended
}

/// Why the last workout ended. `runtimeReload` is the one a caller cannot cause
/// and must still be able to see: a dev reload or an OTA apply ends and SAVES
/// the workout deterministically, and the fresh runtime — which never started
/// it — learns about it from its first `getWorkoutState()`. Keep in sync with
/// the `endedReason` union in js/codegen/schema.ts.
public enum WorkoutEndReason: String, CaseIterable, Sendable {
    case requested
    case discarded
    case runtimeReload
    case failed
}

/// A validated `startWorkout` request.
public struct WorkoutStartPlan: Equatable, Sendable {
    /// The `HKWorkoutActivityType` case name; resolved natively.
    public let activityType: String
    public let location: WorkoutLocation?
    /// Coalescing period for the `workout.metrics` push.
    public let metricsIntervalMs: Double
    /// Record an `HKWorkoutRoute` from the location stream SensorBridge already
    /// owns. Needs the `location` feature too — the one cross-feature check.
    public let collectRoute: Bool

    /// Default metrics period. `didCollectDataOf` fires per collected sample
    /// (heart rate is ~1 Hz under a workout) and every push crosses the bridge
    /// and can commit a render, so this is a direct battery knob — the same
    /// reasoning as `SensorBridge.motionInterval`.
    public static let defaultMetricsIntervalMs: Double = 1000
    /// Floor, for the same reason the motion streams have one: a 0 would ask
    /// for a bridge crossing per collected sample.
    public static let minMetricsIntervalMs: Double = 250

    private struct Payload: Decodable {
        let activityType: String?
        let location: String?
        let metricsIntervalMs: Double?
        let collectRoute: Bool?
    }

    public static func decode(json: String) -> Result<WorkoutStartPlan, HealthRequestError> {
        guard
            let payload = try? JSONDecoder().decode(
                Payload.self, from: Data(json.utf8))
        else { return .failure(HealthRequestError("startWorkout needs a JSON object")) }
        guard let activityType = payload.activityType, !activityType.isEmpty else {
            return .failure(
                HealthRequestError("startWorkout needs an activityType"))
        }
        var location: WorkoutLocation?
        if let name = payload.location {
            guard let parsed = WorkoutLocation(rawValue: name) else {
                return .failure(
                    HealthRequestError(
                        "unknown workout location '\(name)' — expected indoor or outdoor"
                    ))
            }
            location = parsed
        }
        let interval = payload.metricsIntervalMs ?? defaultMetricsIntervalMs
        guard interval.isFinite else {
            return .failure(
                HealthRequestError("metricsIntervalMs must be a finite number"))
        }
        return .success(
            WorkoutStartPlan(
                activityType: activityType,
                location: location,
                metricsIntervalMs: Swift.max(minMetricsIntervalMs, interval),
                collectRoute: payload.collectRoute ?? false))
    }
}
