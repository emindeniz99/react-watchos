// HealthKit READ queries for js/src/health.ts, routed through the invoke
// channel. watchOS-only, like the rest of ReactWatchHost: the whole file
// compiles to nothing off-watchOS so `swift test` still runs on Linux — which
// is exactly why every rule a malformed request has to trip lives in
// ReactWatchSupport's HealthQueryPlan (Linux-tested) and this file only turns a
// VALIDATED plan into a HealthKit query.
//
// Query APIs: the `HK*QueryDescriptor` family (watchOS 8.5, below the v10
// floor), not the pre-descriptor `HKSampleQuery`/`HKStatisticsQuery` classes.
// Their `result(for:)` is `async throws`, which drops straight into the host's
// existing Task -> hop to main -> generation-guard settle pattern; the callback
// classes would need hand-rolled cancellation for no benefit.
#if os(watchOS)
import Foundation
import HealthKit
import ReactWatchSupport

/// One HealthKit read bridge per model. `@MainActor` deliberately: the auth
/// cache below is mutable state read and written around `await`s, and pinning
/// the whole bridge to the main actor is what makes that safe without a lock
/// (the model that owns it is `@MainActor` too, so there is no hop).
@MainActor final class HealthQueryBridge {
    /// Settled outcome of one read, already serialized — the `StoreKitBridge`
    /// shape verbatim, so the host's settle is a three-line switch instead of a
    /// generic escaping-async-closure helper (which Swift 6 would make the
    /// caller reason about `Sendable` for, to save nothing).
    enum Outcome {
        case ok(String)  // resultJson
        case error(String)
    }

    private let store = HKHealthStore()

    /// Type identifiers already put through the authorization sheet this
    /// launch. A HealthKit re-request is a silent no-op for the user, but the
    /// round trip is not free and every query below would otherwise pay it.
    private var requested: Set<String> = []

    /// Whether this watch has HealthKit at all.
    static var isAvailable: Bool { HKHealthStore.isHealthDataAvailable() }

    static func quantityType(for kind: HealthQuantityKind) -> HKQuantityType {
        switch kind {
        case .stepCount: HKQuantityType(.stepCount)
        case .activeEnergyBurned: HKQuantityType(.activeEnergyBurned)
        case .distanceWalkingRunning: HKQuantityType(.distanceWalkingRunning)
        case .heartRate: HKQuantityType(.heartRate)
        case .oxygenSaturation: HKQuantityType(.oxygenSaturation)
        }
    }

    /// The unit each type is READ in. Paired with `HealthQuantityKind.unit`,
    /// which is the string reported on the wire — the Support side names it,
    /// this side measures it, and `SupportTests` pins the names.
    static func unit(for kind: HealthQuantityKind) -> HKUnit {
        switch kind {
        case .stepCount: HKUnit.count()
        case .activeEnergyBurned: HKUnit.kilocalorie()
        case .distanceWalkingRunning: HKUnit.meter()
        case .heartRate: HKUnit.count().unitDivided(by: .minute())
        case .oxygenSaturation: HKUnit.percent()
        }
    }

    /// The sleep-analysis CATEGORY type — not expressible as a quantity, which
    /// is why `requestHealthAuthorization` carries a separate `sleep` flag.
    static let sleepType = HKCategoryType(.sleepAnalysis)

    /// `HKCategoryValueSleepAnalysis` -> the wire stage. Mapped by CASE, never
    /// by raw value: Apple does not document the integers, and a hardcoded
    /// table that drifted would mislabel someone's night rather than fail.
    static func stage(forCategoryValue value: Int) -> SleepStage? {
        switch HKCategoryValueSleepAnalysis(rawValue: value) {
        case .inBed: .inBed
        case .awake: .awake
        case .asleepCore: .asleepCore
        case .asleepDeep: .asleepDeep
        case .asleepREM: .asleepREM
        case .asleepUnspecified: .asleepUnspecified
        default: nil
        }
    }

    private static func options(
        for statistic: HealthStatistic
    ) -> HKStatisticsOptions {
        switch statistic {
        case .sum: .cumulativeSum
        case .average: .discreteAverage
        case .min: .discreteMin
        case .max: .discreteMax
        case .mostRecent: .mostRecent
        }
    }

    /// The quantity a given statistic reads off an `HKStatistics`. Shared by the
    /// scalar and the bucketed query so the two cannot answer `"average"` with
    /// different accessors — the class of drift the `options(for:)` table above
    /// would not catch, because both halves compile either way.
    private static func quantity(
        _ statistic: HealthStatistic, from statistics: HKStatistics
    ) -> HKQuantity? {
        switch statistic {
        case .sum: statistics.sumQuantity()
        case .average: statistics.averageQuantity()
        case .min: statistics.minimumQuantity()
        case .max: statistics.maximumQuantity()
        case .mostRecent: statistics.mostRecentQuantity()
        }
    }

    // MARK: - Authorization

    /// Runs the permission sheet for `plan` and reports the only honest signal
    /// HealthKit exposes: whether the sheet was going to be shown. A READ grant
    /// is deliberately NOT reported — Apple states an app cannot know it, and
    /// inventing a verdict here would propagate that lie to every caller.
    func requestAuthorization(
        _ plan: HealthAuthorizationPlan
    ) async -> String {
        guard Self.isAvailable else { return "unavailable" }
        let types = objectTypes(for: plan)
        let alreadyAsked = await requestStatus(for: types) == .unnecessary
        if alreadyAsked {
            markRequested(types)
            return "alreadyRequested"
        }
        await ensureRequested(types)
        return "prompted"
    }

    /// Puts `types` through the sheet once per launch. The queries call this
    /// for the single type they read, so a caller that never called
    /// `requestHealthAuthorization` still gets a prompt instead of a silently
    /// empty result.
    private func ensureRequested(_ types: Set<HKObjectType>) async {
        let missing = types.filter { !requested.contains($0.identifier) }
        guard !missing.isEmpty else { return }
        // `toShare: []` — this bridge only READS. Sharing (the workout save) is
        // requested by the workouts feature, which is a separate grant.
        _ = try? await store.requestAuthorization(
            toShare: [], read: Set(missing))
        markRequested(Set(missing))
    }

    private func markRequested(_ types: Set<HKObjectType>) {
        for type in types { requested.insert(type.identifier) }
    }

    private func objectTypes(
        for plan: HealthAuthorizationPlan
    ) -> Set<HKObjectType> {
        var types = Set(plan.kinds.map { Self.quantityType(for: $0) as HKObjectType })
        if plan.sleep { types.insert(Self.sleepType) }
        return types
    }

    /// `getRequestStatusForAuthorization` (watchOS 5.0) wrapped as async. The
    /// completion-handler spelling is used deliberately — it is the one this
    /// project verified against Apple's docs JSON at our floor.
    private func requestStatus(
        for types: Set<HKObjectType>
    ) async -> HKAuthorizationRequestStatus {
        await withCheckedContinuation { continuation in
            store.getRequestStatusForAuthorization(toShare: [], read: types) {
                status, _ in
                continuation.resume(returning: status)
            }
        }
    }

    // MARK: - Queries

    /// One aggregate over the plan's window. `value` is `NSNull` when HealthKit
    /// reports no statistic — the honest encoding of "no samples", which is not
    /// distinguishable from a denied read (js/src/health.ts says so).
    func statistics(_ plan: HealthStatisticsPlan) async -> Outcome {
        let type = Self.quantityType(for: plan.kind)
        await ensureRequested([type])
        let descriptor = HKStatisticsQueryDescriptor(
            predicate: HKSamplePredicate.quantitySample(
                type: type,
                predicate: HKQuery.predicateForSamples(
                    withStart: plan.window.start, end: plan.window.end)),
            options: Self.options(for: plan.statistic))
        do {
            let result = try await descriptor.result(for: store)
            let unit = Self.unit(for: plan.kind)
            let quantity = result.flatMap {
                Self.quantity(plan.statistic, from: $0)
            }
            return .ok(
                Self.json([
                    "value": quantity.map { $0.doubleValue(for: unit) } ?? NSNull(),
                    "unit": plan.kind.unit,
                    "startMs": plan.window.startMs,
                    "endMs": plan.window.endMs,
                ]))
        } catch {
            return .error(error.localizedDescription)
        }
    }

    /// The same aggregate, once per DAY — `HKStatisticsCollectionQueryDescriptor`
    /// (watchOS 8.5), which is one HealthKit round trip for a week chart that
    /// used to cost seven `queryHealthStatistics` invokes. That is the whole
    /// reason this exists: seven queries' worth of HealthKit work on a watch is
    /// a battery cost, not a style preference.
    ///
    /// Two choices worth naming:
    ///
    /// - `anchorDate` is the window's OWN start, so the caller decides where a
    ///   "day" begins by choosing `startMs`. That keeps the time zone in JS,
    ///   where the calendar actually is — a `Calendar.current`-derived midnight
    ///   here would silently disagree with the labels the caller renders.
    /// - `enumerateStatistics(from:to:)`, not `statistics()`. Apple documents
    ///   the latter as skipping intervals with no samples ("there may be
    ///   arbitrarily large gaps"), which would return five buckets for a week
    ///   the user rested twice and leave every caller re-deriving which days
    ///   are missing. The former "calls the block once for each time interval"
    ///   with a `nil`-valued quantity when a day is empty, which is exactly the
    ///   `value: null` the scalar query already means.
    func dailyStatistics(_ plan: HealthStatisticsPlan) async -> Outcome {
        let type = Self.quantityType(for: plan.kind)
        await ensureRequested([type])
        let descriptor = HKStatisticsCollectionQueryDescriptor(
            predicate: HKSamplePredicate.quantitySample(
                type: type,
                predicate: HKQuery.predicateForSamples(
                    withStart: plan.window.start, end: plan.window.end)),
            options: Self.options(for: plan.statistic),
            anchorDate: plan.window.start,
            intervalComponents: DateComponents(day: 1))
        let unit = Self.unit(for: plan.kind)
        let unitName = plan.kind.unit
        let statistic = plan.statistic
        let window = plan.window
        do {
            let collection = try await descriptor.result(for: store)
            var buckets: [[String: Any]] = []
            collection.enumerateStatistics(
                from: window.start, to: window.end
            ) { statistics, _ in
                let startMs = statistics.startDate.timeIntervalSince1970 * 1000
                // The off-by-one Apple's own contract introduces: the last
                // interval is the one CONTAINING `end`, so a window ending on a
                // bucket boundary yields one bucket too many. The rule lives in
                // ReactWatchSupport so it is proven on Linux, not asserted here.
                guard window.containsBucketStart(startMs) else { return }
                let quantity = Self.quantity(statistic, from: statistics)
                buckets.append([
                    "value": quantity.map { $0.doubleValue(for: unit) } ?? NSNull(),
                    "unit": unitName,
                    "startMs": startMs,
                    "endMs": statistics.endDate.timeIntervalSince1970 * 1000,
                ])
            }
            return .ok(Self.json(buckets))
        } catch {
            return .error(error.localizedDescription)
        }
    }

    /// Raw quantity samples, newest first.
    func samples(_ plan: HealthSamplesPlan) async -> Outcome {
        let type = Self.quantityType(for: plan.kind)
        await ensureRequested([type])
        let descriptor = HKSampleQueryDescriptor(
            predicates: [
                .quantitySample(
                    type: type,
                    predicate: HKQuery.predicateForSamples(
                        withStart: plan.window.start, end: plan.window.end))
            ],
            sortDescriptors: [SortDescriptor(\.startDate, order: .reverse)],
            limit: plan.window.limit ?? HealthWindow.maxLimit)
        let unit = Self.unit(for: plan.kind)
        let unitName = plan.kind.unit
        do {
            let samples = try await descriptor.result(for: store)
            return .ok(
                Self.json(
                    samples.map { sample in
                        [
                            "startMs": sample.startDate.timeIntervalSince1970 * 1000,
                            "endMs": sample.endDate.timeIntervalSince1970 * 1000,
                            "value": sample.quantity.doubleValue(for: unit),
                            "unit": unitName,
                        ]
                    }))
        } catch {
            return .error(error.localizedDescription)
        }
    }

    /// Staged sleep intervals, newest first. A sample whose category value this
    /// binary doesn't recognize is DROPPED rather than mapped to a neighbour —
    /// the same forward-compat posture the interpreters take for an unknown
    /// node type.
    func sleepSamples(_ plan: SleepSamplesPlan) async -> Outcome {
        await ensureRequested([Self.sleepType])
        let descriptor = HKSampleQueryDescriptor(
            predicates: [
                .categorySample(
                    type: Self.sleepType,
                    predicate: HKQuery.predicateForSamples(
                        withStart: plan.window.start, end: plan.window.end))
            ],
            sortDescriptors: [SortDescriptor(\.startDate, order: .reverse)],
            limit: plan.window.limit ?? HealthWindow.maxLimit)
        do {
            let samples = try await descriptor.result(for: store)
            return .ok(
                Self.json(
                    samples.compactMap { sample -> [String: Any]? in
                        guard let stage = Self.stage(forCategoryValue: sample.value)
                        else { return nil }
                        return [
                            "startMs": sample.startDate.timeIntervalSince1970 * 1000,
                            "endMs": sample.endDate.timeIntervalSince1970 * 1000,
                            "stage": stage.rawValue,
                        ]
                    }))
        } catch {
            return .error(error.localizedDescription)
        }
    }

    /// JSON for an already-JSON-safe object/array (numbers, strings, NSNull).
    private static func json(_ value: Any) -> String {
        (try? JSONSerialization.data(withJSONObject: value))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "null"
    }
}
#endif
