// Which HealthKit type a workout's DISTANCE is recorded under. watchOS-only,
// like the rest of ReactWatchHost.
//
// HealthKit has no single "distance": it records a workout's distance under a
// quantity type that depends on the ACTIVITY, so asking a ride for
// `distanceWalkingRunning` reports NOTHING — not "zero metres", nothing at all,
// which is indistinguishable on the wire from a yoga session that really did
// cover no ground. Apple says as much in the deprecation note on
// `HKWorkout.totalDistance`: the replacement takes "the HKQuantityType for the
// desired distance type", and the singular is the caller's problem.
//
// Both halves of the workout story need that answer — WorkoutBridge for the
// LIVE builder, HealthQueryBridge for a SAVED `HKWorkout` — and two activity
// tables are two chances to disagree about the same ride, which is how a watch
// ends up showing 12 km while the workout runs and "—" once it is saved. So
// there is one table, here.
#if os(watchOS)
import HealthKit

enum WorkoutDistance {
    /// The distance type `activity` records under.
    ///
    /// The default is walking/running rather than "no distance", because that
    /// is also the honest answer for every activity HealthKit gives no distance
    /// type of its own (yoga, strength training): the type exists, the workout
    /// simply has no samples of it, and `statistics(for:)` reports that as nil.
    ///
    /// Rowing, paddling, cross-country skiing and skating are deliberately NOT
    /// here. `distanceRowing`, `distancePaddleSports`,
    /// `distanceCrossCountrySkiing` and `distanceSkatingSports` are all watchOS
    /// **11.0** — above this package's watchOS 10 floor — and this package is
    /// `@available`-free by policy, so they fall to the default and read as
    /// nil rather than drag a version gate into a lookup table. Revisit when
    /// the floor moves.
    static func identifier(
        for activity: HKWorkoutActivityType
    ) -> HKQuantityTypeIdentifier {
        switch activity {
        case .cycling, .handCycling: .distanceCycling
        case .swimming: .distanceSwimming
        case .wheelchairWalkPace, .wheelchairRunPace: .distanceWheelchair
        case .downhillSkiing, .snowboarding, .snowSports: .distanceDownhillSnowSports
        default: .distanceWalkingRunning
        }
    }

    /// The same table keyed by the WIRE activity name, for the live side, which
    /// holds a decoded `WorkoutStartPlan` rather than an `HKWorkoutActivityType`.
    /// An absent or unknown name takes the default — a session with no plan is
    /// the heart-rate pump's `.other`, which records no distance either way.
    static func identifier(forName name: String?) -> HKQuantityTypeIdentifier {
        guard let name, let activity = WorkoutActivityName.type(for: name) else {
            return .distanceWalkingRunning
        }
        return identifier(for: activity)
    }

    /// Every type the table can return.
    ///
    /// A HISTORY read needs the whole set for authorization: which activities a
    /// window holds is not knowable until the query has already run, so asking
    /// for one activity's distance type would leave the others reading nil for
    /// a reason the user never saw a sheet row for.
    ///
    /// COMPUTED, not a `static let`: this enum is nonisolated, and a stored
    /// static of a type Swift 6 cannot prove `Sendable` is global mutable state
    /// by the compiler's reckoning. A five-element array costs nothing to
    /// rebuild, and the two callers ask once per query.
    static var allIdentifiers: [HKQuantityTypeIdentifier] {
        [
            .distanceWalkingRunning,
            .distanceCycling,
            .distanceSwimming,
            .distanceWheelchair,
            .distanceDownhillSnowSports,
        ]
    }
}
#endif
