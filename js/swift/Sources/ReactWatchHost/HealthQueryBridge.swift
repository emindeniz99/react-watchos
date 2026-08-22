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

    /// One batch for a live stream — the new samples (already JSON-safe) and
    /// the uuids of samples DELETED from HealthKit, plus the event NAME it
    /// belongs on. Wired in `ReactWatchHost` to `pushNativeEvent`, the same way
    /// `sensors.onReading` is — this bridge does not know the runtime exists.
    /// Either array can be empty, never both: an update carrying neither is not
    /// pushed at all.
    var onSamples:
        ((_ event: String, _ samples: [[String: Any]], _ deletedIds: [String]) -> Void)?

    /// The live query per type. A `Task`, because an
    /// `HKAnchoredObjectQueryDescriptor` has no `stop(_:)` — the descriptor
    /// family's cancellation IS task cancellation — so the handle we keep is
    /// the only way to end one.
    private var updateTasks: [HealthQuantityKind: Task<Void, Never>] = [:]

    /// DESIRED state, kept apart from `updateTasks` (which is actual state).
    /// The pair is the whole lifecycle: wanted with no task means "should be
    /// streaming but isn't" — backgrounded, or still inside the authorization
    /// window — and that is exactly what the foreground resume restarts. The
    /// `SensorBridge` heart-rate latch expressed as two maps instead of three
    /// flags, because here it is per TYPE.
    private var wantedUpdates: [HealthQuantityKind: HealthUpdatesPlan] = [:]

    /// One live query's identity. Bumped on every start, stop, background pause
    /// and teardown for a type — everything that supersedes a running or
    /// half-started query — and claimed SYNCHRONOUSLY (`beginUpdates`), so a
    /// synchronous stop always has an epoch to move.
    ///
    /// The authorization sheet is a real suspension, and a stop (or a
    /// stop-then-restart, which is what React StrictMode's double mount does)
    /// can land inside it: without this, the superseded start would resume after
    /// the `await`, see a `wantedUpdates` entry the SECOND start put there, and
    /// arm a second query for the same type whose task handle is immediately
    /// overwritten — an orphan that pushes duplicate samples until the next
    /// reload, with nothing left to cancel it. It is also what the query's own
    /// emit guard asks, so a batch in flight when the app backgrounds is dropped
    /// rather than delivered.
    private var updateEpochs: [HealthQuantityKind: Int] = [:]

    /// scenePhase mirror, the `SensorBridge.isBackgrounded` rule verbatim: an
    /// authorization completion that lands while the app is away must not arm a
    /// query nobody can see. This feature is foreground-only by design (no
    /// background-delivery entitlement), so "away" means "not now".
    private var isBackgrounded = false

    /// Whether this watch has HealthKit at all.
    static var isAvailable: Bool { HKHealthStore.isHealthDataAvailable() }

    static func quantityType(for kind: HealthQuantityKind) -> HKQuantityType {
        switch kind {
        case .stepCount: HKQuantityType(.stepCount)
        case .activeEnergyBurned: HKQuantityType(.activeEnergyBurned)
        case .distanceWalkingRunning: HKQuantityType(.distanceWalkingRunning)
        case .heartRate: HKQuantityType(.heartRate)
        case .oxygenSaturation: HKQuantityType(.oxygenSaturation)
        case .heartRateVariabilitySDNN: HKQuantityType(.heartRateVariabilitySDNN)
        case .restingHeartRate: HKQuantityType(.restingHeartRate)
        case .appleExerciseTime: HKQuantityType(.appleExerciseTime)
        case .basalEnergyBurned: HKQuantityType(.basalEnergyBurned)
        case .respiratoryRate: HKQuantityType(.respiratoryRate)
        case .flightsClimbed: HKQuantityType(.flightsClimbed)
        case .vo2Max: HKQuantityType(.vo2Max)
        case .walkingHeartRateAverage: HKQuantityType(.walkingHeartRateAverage)
        case .appleStandTime: HKQuantityType(.appleStandTime)
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
        case .heartRateVariabilitySDNN: HKUnit.secondUnit(with: .milli)
        case .restingHeartRate: HKUnit.count().unitDivided(by: .minute())
        case .appleExerciseTime: HKUnit.minute()
        case .basalEnergyBurned: HKUnit.kilocalorie()
        case .respiratoryRate: HKUnit.count().unitDivided(by: .minute())
        case .flightsClimbed: HKUnit.count()
        // Composed, not parsed from `HealthQuantityKind.unit`: `HKUnit(from:)`
        // THROWS an ObjC exception on a string it dislikes, and this is the one
        // read whose unit has three components to get wrong. Built as
        // ml / (kg * min) so the grouping is in the type system rather than in
        // a string whose two division symbols Apple's own parser rule forbids.
        case .vo2Max:
            HKUnit.literUnit(with: .milli).unitDivided(
                by: HKUnit.gramUnit(with: .kilo).unitMultiplied(by: HKUnit.minute()))
        case .walkingHeartRateAverage: HKUnit.count().unitDivided(by: .minute())
        case .appleStandTime: HKUnit.minute()
        }
    }

    /// The sleep-analysis CATEGORY type — not expressible as a quantity, which
    /// is why `requestHealthAuthorization` carries a separate `sleep` flag.
    static let sleepType = HKCategoryType(.sleepAnalysis)

    /// The Activity rings. `HKObjectType.activitySummaryType()` is a third kind
    /// of read type again — neither quantity nor category — hence its own
    /// `activitySummaries` flag, the `sleep` precedent verbatim.
    ///
    /// It is asked for ALONE, unlike `workoutHistoryTypes`: an `HKActivitySummary`
    /// is one object HealthKit hands over whole, goals included, not a total
    /// recomputed from samples that each carry their own grant. Apple also
    /// states summaries can be READ but never SHARED, which is already how this
    /// bridge asks for everything (`toShare: []` in `ensureRequested`).
    /// Typed as `HKObjectType`, the type the sheet and every set below deal
    /// in — which also lets `HealthQueryBridgeMappingTests` ask, on a watch,
    /// what this actually IS (an `HKActivitySummaryType`, and neither of the two
    /// kinds that could have ridden the `read` list instead).
    static let activitySummaryType: HKObjectType = HKObjectType.activitySummaryType()

    /// Saved workouts. `HKObjectType.workoutType()` is neither a quantity nor a
    /// category type — it is its own thing — which is why
    /// `requestHealthAuthorization` carries a separate `workoutHistory` flag
    /// for it, exactly as it does for sleep.
    static let workoutType = HKObjectType.workoutType()

    /// Every type a workout SUMMARY reads — the workout itself plus the
    /// quantity types its energy and distance are computed from.
    ///
    /// `HKWorkout.statistics(for:)` is not a property of the workout: Apple
    /// documents it as calculated "based on the `HKQuantitySample` objects
    /// ASSOCIATED with the workout", and a quantity sample carries its own
    /// per-type read grant. Authorizing the workout type alone would therefore
    /// risk a history list whose every row reports `activeEnergyKcal` and
    /// `distanceMeters` as null — silently, forever, and reported to JS as
    /// "this workout measured nothing". Asking for a type that is already
    /// readable costs nothing, so the ask is the whole set the read can touch:
    /// the distance one a given row needs is not knowable until after the query
    /// has run.
    static var workoutHistoryTypes: Set<HKObjectType> {
        var types: Set<HKObjectType> = [workoutType, HKQuantityType(.activeEnergyBurned)]
        for identifier in WorkoutDistance.allIdentifiers {
            types.insert(HKQuantityType(identifier))
        }
        return types
    }

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
        let types = Self.objectTypes(for: plan)
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

    /// `internal`, not `private`, so `HealthQueryBridgeMappingTests` can ask
    /// what a decoded plan actually reaches the SHEET as — the join no textual
    /// scan can make, and the one that decides which rows a user is shown.
    ///
    /// `static` because it reads no instance state — only the type table above.
    /// That is what lets the test call it without constructing a bridge, and so
    /// without allocating an `HKHealthStore`, which keeps that file's stated
    /// contract (nothing in it touches a store) true in the one job nothing
    /// here can run.
    static func objectTypes(
        for plan: HealthAuthorizationPlan
    ) -> Set<HKObjectType> {
        var types = Set(plan.kinds.map { Self.quantityType(for: $0) as HKObjectType })
        if plan.sleep { types.insert(Self.sleepType) }
        // No new ENTITLEMENT and no new usage-description key ride along with
        // this one: reading saved workouts is covered by
        // `com.apple.developer.healthkit` + `NSHealthShareUsageDescription`,
        // both of which js/plugin/targetConfig.cts already writes. What it does
        // add is ROWS in the sheet the user sees — saved workouts, and the
        // energy/distance types their summaries are computed from — which is
        // why that key's default sentence names all three.
        if plan.workoutHistory { types.formUnion(Self.workoutHistoryTypes) }
        if plan.activitySummaries { types.insert(Self.activitySummaryType) }
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

    /// The same aggregate, once per DAY — see `bucketedStatistics`, which is
    /// the whole implementation: the two bucketed queries differ only in the
    /// stride, and two hand-written descriptors would drift on the decisions
    /// that ARE this feature (the anchor, the contiguous enumeration, the
    /// boundary rule).
    func dailyStatistics(_ plan: HealthStatisticsPlan) async -> Outcome {
        await bucketedStatistics(plan, stride: DateComponents(day: 1))
    }

    /// ... and once per HOUR (`healthHourlyBuckets`, taken 2026-08-22). The
    /// stride is the only difference; the hourly-only rule — a ceiling counted
    /// in hours — was already applied by `HealthStatisticsPlan.decodeHourly`
    /// before this bridge was touched.
    func hourlyStatistics(_ plan: HealthStatisticsPlan) async -> Outcome {
        await bucketedStatistics(plan, stride: DateComponents(hour: 1))
    }

    /// One aggregate per `stride` across the window —
    /// `HKStatisticsCollectionQueryDescriptor` (watchOS 8.5), which is one
    /// HealthKit round trip for a chart that used to cost one
    /// `queryHealthStatistics` invoke per bar. That is the whole reason this
    /// exists: a query per bar on a watch is a battery cost, not a style
    /// preference.
    ///
    /// Two choices worth naming:
    ///
    /// - `anchorDate` is the window's OWN start, so the caller decides where a
    ///   bucket begins by choosing `startMs`. That keeps the time zone in JS,
    ///   where the calendar actually is — a `Calendar.current`-derived midnight
    ///   here would silently disagree with the labels the caller renders. For
    ///   the HOUR stride the anchor is the whole timezone story: hour steps are
    ///   uniform 3600 s (DST moves labels, never hour lengths), so bucket *n*
    ///   is `startMs + n·3600000` on every watch.
    /// - `enumerateStatistics(from:to:)`, not `statistics()`. Apple documents
    ///   the latter as skipping intervals with no samples ("there may be
    ///   arbitrarily large gaps"), which would return five buckets for a week
    ///   the user rested twice and leave every caller re-deriving which days
    ///   are missing. The former "calls the block once for each time interval"
    ///   with a `nil`-valued quantity when a bucket is empty, which is exactly
    ///   the `value: null` the scalar query already means.
    private func bucketedStatistics(
        _ plan: HealthStatisticsPlan, stride: DateComponents
    ) async -> Outcome {
        let type = Self.quantityType(for: plan.kind)
        await ensureRequested([type])
        let descriptor = HKStatisticsCollectionQueryDescriptor(
            predicate: HKSamplePredicate.quantitySample(
                type: type,
                predicate: HKQuery.predicateForSamples(
                    withStart: plan.window.start, end: plan.window.end)),
            options: Self.options(for: plan.statistic),
            anchorDate: plan.window.start,
            intervalComponents: stride)
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
                            // HKObject.uuid (watchOS 2.0): the identity a
                            // live-stream deletion retracts by, and a stable
                            // list key. On the query row too — same shape as a
                            // live row, by contract — so a subscriber can seed
                            // from history and then apply deletions against it.
                            "id": sample.uuid.uuidString,
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

    /// Saved workouts in the window, newest first — the list a "your last five
    /// runs" screen renders. The one read in this file whose SUBJECT is the
    /// workout rather than a measurement taken during one.
    ///
    /// `HKSamplePredicate.workout(_:)` is generic over `HKWorkout`, so the
    /// descriptor's result is `[HKWorkout]` with no cast and no
    /// `compactMap { $0 as? }` that could silently drop rows.
    ///
    /// Energy and distance are read through `statistics(for:)` rather than
    /// `totalEnergyBurned`/`totalDistance`, which Apple deprecated (watchOS
    /// 11.0 / 27.0). The replacement is also the more honest one: a nil
    /// statistic means the workout recorded NO samples of that type — an indoor
    /// yoga session has no distance at all — and that is a different fact from
    /// "covered zero metres", so it crosses the wire as `null`. It is a
    /// narrower read too, and the JSDoc says so: a workout another app saved as
    /// a TOTAL with no per-sample data behind it has no statistics to compute.
    ///
    /// The window predicate is HealthKit's default (`options: []`), which Apple
    /// documents as `endDate >= start AND startDate < end` — OVERLAP, not
    /// start-containment. Deliberate, and the same rule the sample reads above
    /// run under (`HKQueryOptions` is unexposed by design — see
    /// docs/design-health-package.md): for a near-instantaneous quantity sample
    /// the two rules coincide, and for an hour-long workout overlap is the one
    /// that keeps a hike from vanishing because the caller's window cut it in
    /// half. `queryWorkoutHistory`'s JSDoc states this rule rather than the
    /// `[startMs, endMs)` framing the other reads use.
    func workoutHistory(_ plan: WorkoutHistoryPlan) async -> Outcome {
        await ensureRequested(Self.workoutHistoryTypes)
        let descriptor = HKSampleQueryDescriptor(
            predicates: [
                .workout(
                    HKQuery.predicateForSamples(
                        withStart: plan.window.start, end: plan.window.end))
            ],
            sortDescriptors: [SortDescriptor(\.startDate, order: .reverse)],
            limit: plan.window.limit ?? HealthWindow.maxLimit)
        do {
            let workouts: [HKWorkout] = try await descriptor.result(for: store)
            return .ok(
                Self.json(
                    workouts.map { workout in
                        var row: [String: Any] = [
                            "id": workout.uuid.uuidString,
                            "startMs": workout.startDate.timeIntervalSince1970 * 1000,
                            "endMs": workout.endDate.timeIntervalSince1970 * 1000,
                            // `duration` is seconds and EXCLUDES paused time, so
                            // it is not endMs - startMs. Reported in ms like
                            // every other duration on this wire.
                            "durationMs": workout.duration * 1000,
                            "activeEnergyKcal": Self.total(
                                HKQuantityType(.activeEnergyBurned), of: workout,
                                in: .kilocalorie()) ?? NSNull(),
                            // NOT `distanceWalkingRunning` for everything: a
                            // ride's metres are `distanceCycling` and a swim's
                            // are `distanceSwimming`, so a fixed type would
                            // report null for every ride in the list and call
                            // it "measured nothing". `WorkoutDistance` is the
                            // same table the LIVE workout reads through.
                            "distanceMeters": Self.total(
                                HKQuantityType(
                                    WorkoutDistance.identifier(
                                        for: workout.workoutActivityType)),
                                of: workout, in: .meter()) ?? NSNull(),
                        ]
                        // OMITTED rather than guessed when this binary's
                        // vocabulary has no name for the stored case — the
                        // `getWorkoutState` rule verbatim, and not hypothetical
                        // here: this list also contains workouts OTHER apps
                        // saved, including the deprecated activity spellings
                        // this package excludes. Reuses the generated table
                        // backwards; a second mapping would be a second thing
                        // to drift.
                        if let name = WorkoutActivityName.name(
                            for: workout.workoutActivityType)
                        {
                            row["activityType"] = name
                        }
                        return row
                    }))
        } catch {
            return .error(error.localizedDescription)
        }
    }

    /// One workout's summed statistic for a type, or nil when it recorded no
    /// samples of that type. `nil` is the answer, never 0 — see the caller.
    private static func total(
        _ type: HKQuantityType, of workout: HKWorkout, in unit: HKUnit
    ) -> Double? {
        workout.statistics(for: type)?.sumQuantity()?.doubleValue(for: unit)
    }

    /// The Activity rings — move, exercise and stand, each with the GOAL it is
    /// scored against — one row per day.
    ///
    /// This is the read the goals justify. No `HKQuantityType` exposes one:
    /// `appleExerciseTime` reports the minutes and stops there, so before this a
    /// caller could know a user exercised 23 minutes and still not know whether
    /// that closed the ring. An arc needs both numbers.
    ///
    /// `HKActivitySummaryQueryDescriptor` (watchOS 8.5), not the callback class
    /// `HKActivitySummaryQuery`: the descriptor's `result(for:)` is `async
    /// throws`, matching every other query in this file, and its docs carry the
    /// availability the class's page does not.
    ///
    /// Rows come back OLDEST DAY FIRST — sorted below, because HealthKit
    /// promises no order — and a day it has no summary for is simply absent,
    /// which is why every row carries its own date.
    ///
    /// The predicate is the part that fails SILENTLY when it is wrong. Activity
    /// summaries are matched by `DateComponents` identifying a day "as perceived
    /// by the user", and a components set whose `calendar` is unset matches
    /// nothing at all — no throw, just an empty array a caller reads as "no
    /// rings". So this bridge builds no components: `ActivityDay.components`
    /// does, with the calendar attached by construction, in ReactWatchSupport
    /// where `swift test` proves it on Linux.
    func activitySummaries(_ plan: ActivitySummariesPlan) async -> Outcome {
        await ensureRequested([Self.activitySummaryType])
        let descriptor = HKActivitySummaryQueryDescriptor(
            predicate: HKQuery.predicate(
                forActivitySummariesBetweenStart: plan.start.components,
                end: plan.end.components))
        do {
            let summaries = try await descriptor.result(for: store)
            // ONE calendar for the whole answer, and the same definition the
            // query was built from. `ActivityDay.calendar` is computed — it
            // re-reads the system zone — so binding it here is both cheaper per
            // row and the guarantee that every row of a thousand-day answer is
            // dated by a single zone.
            let calendar = ActivityDay.calendar
            let rows = summaries.compactMap {
                summary -> (day: ActivityDay, row: [String: Any])? in
                // DROPPED, not guessed, on either unknown — the sleep read's
                // rule. A row whose day cannot be read is a bar a chart cannot
                // place, and a row whose move mode this binary cannot name would
                // be drawn as the wrong ring entirely. A missing day renders as
                // missing; a mislabelled one renders as a lie.
                guard
                    let day = ActivityDay(
                        components: summary.dateComponents(for: calendar)),
                    let mode = Self.moveMode(for: summary.activityMoveMode)
                else { return nil }
                return (
                    day,
                    [
                        "date": day.iso,
                        "moveMode": mode.rawValue,
                        "activeEnergyKcal": summary.activeEnergyBurned
                            .doubleValue(for: .kilocalorie()),
                        // NOT optional at this floor, and the whole point of the
                        // method: this is the number the move ring is drawn
                        // against.
                        "activeEnergyGoalKcal": summary.activeEnergyBurnedGoal
                            .doubleValue(for: .kilocalorie()),
                        // The move ring's OTHER spelling, reported whichever mode
                        // is active: on the day a user switches modes (or turns
                        // 18) the pair that matters changes, and a second query to
                        // find out costs more than two numbers.
                        "moveTimeMinutes": summary.appleMoveTime
                            .doubleValue(for: .minute()),
                        "moveTimeGoalMinutes": summary.appleMoveTimeGoal
                            .doubleValue(for: .minute()),
                        "exerciseMinutes": summary.appleExerciseTime
                            .doubleValue(for: .minute()),
                        // `exerciseTimeGoal`, the LIVE spelling (watchOS 9.0).
                        // `appleExerciseTimeGoal` is deprecated at watchOS 27.0
                        // and reports the same ring.
                        "exerciseGoalMinutes": Self.goal(
                            summary.exerciseTimeGoal, in: .minute()),
                        // Stand is a COUNT of hours, not a duration: the ring is
                        // "10 of 12 hours", and HealthKit measures both halves in
                        // count units.
                        "standHours": summary.appleStandHours
                            .doubleValue(for: .count()),
                        // `standHoursGoal`, again the live spelling —
                        // `appleStandHoursGoal` is deprecated at 27.0.
                        "standHoursGoal": Self.goal(
                            summary.standHoursGoal, in: .count()),
                    ]
                )
            }
            // OLDEST DAY FIRST, sorted here rather than assumed. The descriptor
            // takes no sort descriptors and Apple documents `result(for:)` only
            // as "a snapshot of the current matching results" — no order at all —
            // so a caller drawing the obvious seven-bar chart straight off the
            // array would be right by luck, and silently reversed the day
            // HealthKit's enumeration changed. Ascending, unlike the newest-first
            // sample reads next door, because a ring history is read left to
            // right as a chart. `serial` and not `iso` so the key is the same
            // arithmetic the day ceiling is counted with.
            return .ok(
                Self.json(
                    rows.sorted { $0.day.serial < $1.day.serial }.map { $0.row }))
        } catch {
            return .error(error.localizedDescription)
        }
    }

    /// `HKActivityMoveMode` -> the wire mode, by CASE like every other Apple
    /// enum this bridge maps: the raw integers are undocumented, and a table
    /// that drifted would tell a move-time user their calorie ring closed.
    /// A mode this binary cannot name has no honest answer — the caller would
    /// have to draw SOME ring — so the row is dropped instead.
    static func moveMode(for mode: HKActivityMoveMode) -> ActivityMoveMode? {
        switch mode {
        case .activeEnergy: .activeEnergy
        case .appleMoveTime: .appleMoveTime
        @unknown default: nil
        }
    }

    /// A goal HealthKit may not have (the watchOS 9.0 optional spellings), as
    /// the wire sees it: a number or `null`, NEVER a substituted default. A ring
    /// with no goal cannot be drawn, and inventing Apple's 30 minutes would draw
    /// one the user was never scored against.
    private static func goal(_ quantity: HKQuantity?, in unit: HKUnit) -> Any {
        quantity.map { $0.doubleValue(for: unit) } ?? NSNull()
    }

    // MARK: - Live updates (js/src/health.ts startHealthUpdates)

    /// The SYNCHRONOUS half of a start: claim this type's epoch and record what
    /// the app now wants. Returns the epoch `finishUpdates` must still hold to
    /// arm, or `nil` when the type is already streaming.
    ///
    /// Split from the async half because `stopUpdates` is synchronous and this
    /// is not: the invoke channel is a synchronous QuickJS callback, so a JS
    /// turn that starts and then stops runs both handlers before any `Task`
    /// body does. If the start registered nothing until its task ran, that stop
    /// — and `stopAllUpdates()` on a reload — would find no epoch to move and
    /// no `wantedUpdates` entry to clear, and the start would then arm a query
    /// with no subscriber left and nothing able to cancel it. Claiming here
    /// means every stop bumps an epoch that already exists, so the deferred
    /// half can always see that it was superseded.
    ///
    /// IDEMPOTENT for a type already streaming. The JS side refcounts
    /// subscribers and sends exactly one start per type, so a second one means
    /// the two sides desynced (a reload, a stop that crossed a start); joining
    /// the running query is the answer that cannot produce two of them. That
    /// join must be a true no-op on BOTH maps — bumping the epoch past the
    /// running task's would break the self-heal in `startQuery`'s tail, and
    /// re-latching `wantedUpdates` would re-arm the next foreground at the
    /// second subscriber's interval. So the FIRST subscriber's `minIntervalMs`
    /// wins, which is the rule `startSensor`'s options already follow.
    func beginUpdates(_ plan: HealthUpdatesPlan) -> Int? {
        let kind = plan.kind
        guard updateTasks[kind] == nil else { return nil }
        let epoch = (updateEpochs[kind] ?? 0) + 1
        updateEpochs[kind] = epoch
        wantedUpdates[kind] = plan
        return epoch
    }

    /// The async half: the authorization round trip, then the query — if this
    /// start still owns `epoch`.
    ///
    /// The `Outcome` is what makes this different from every other start in the
    /// package: `startSensor` is a fire-and-forget direct method with no reply
    /// path, so a heart-rate stream that never starts is a screen showing "—"
    /// and nothing in the log. This one settles, so the failure has somewhere to
    /// go. It only ever settles OK today: the two things that can go wrong
    /// before here — no HealthKit, an unreadable type — are decided by the host
    /// before the bridge is touched, and HealthKit does not report a DENIED read
    /// grant at all (`requestAuthorization` succeeds either way, by design, so
    /// an app cannot infer what the user hid). A denied read is therefore
    /// indistinguishable from "no samples yet", which is what the JSDoc says.
    func finishUpdates(_ plan: HealthUpdatesPlan, epoch: Int) async -> Outcome {
        let kind = plan.kind
        // The stream asks for its own type, like every read here: a caller who
        // never ran `requestHealthAuthorization` gets a prompt rather than a
        // subscription that silently never fires.
        await ensureRequested([Self.quantityType(for: kind)])
        // THE authorization window. A stop, a reload, or a second start landed
        // while the sheet was up if the epoch moved; whoever moved it owns the
        // stream now, and arming one here would be an orphan (see `updateEpochs`).
        // Resolved rather than rejected: an effect that unmounted mid-start —
        // the StrictMode case — did not FAIL at anything, and rejecting would
        // make every fast unmount log an error.
        guard updateEpochs[kind] == epoch else { return .ok("null") }
        // Backgrounded inside that same window. Left WANTED with no task, which
        // is precisely the state `resumeUpdatesFromForeground` restarts.
        guard !isBackgrounded else { return .ok("null") }
        startQuery(plan)
        return .ok("null")
    }

    /// The query itself. Split from `finishUpdates` because the foreground
    /// resume arms one too, and two hand-written descriptors would drift on the
    /// two decisions below — which are the whole design of this stream.
    private func startQuery(_ plan: HealthUpdatesPlan) {
        let kind = plan.kind
        // Belt and braces against the one interleaving `startUpdates`' epoch
        // cannot see: a foreground resume that fires while a start is still
        // inside its authorization window. One task per type, always.
        guard updateTasks[kind] == nil else { return }
        // This run's identity. Bumped here and not only in `startUpdates` so
        // the FOREGROUND resume supersedes a start still inside its
        // authorization window too — that start then arms nothing rather than
        // racing this one — and so the task below can tell, when it ends,
        // whether the entry it would clear is still its own.
        let epoch = (updateEpochs[kind] ?? 0) + 1
        updateEpochs[kind] = epoch
        let type = Self.quantityType(for: kind)
        let unit = Self.unit(for: kind)
        let unitName = kind.unit
        let event = plan.eventName
        // Seconds, and NOT named `floor`: that would shadow Foundation's
        // `floor(_:)` for the rest of this body, where the next arithmetic
        // anyone adds would fail to compile inside a hundred-line closure.
        let minGapSeconds = plan.minIntervalMs / 1000
        let store = store
        // NEW SAMPLES ONLY, and this is where that is decided. `anchor: nil`
        // means "everything matching, then updates", so the predicate is what
        // keeps the backlog out: with HealthKit's default options — `endDate >=
        // start`, since `end` is nil — a sample that is already OVER when the
        // stream starts does not match, while one still running or saved later
        // for an interval reaching into now does. That last case is not
        // academic: step and energy samples are written AFTER the minutes they
        // cover, so a `startDate`-based cut would drop the straddling sample a
        // live steps screen exists to show. It is the sample's INTERVAL that
        // decides, never its save time — one whose interval was already over at
        // the subscribe instant is not delivered no matter how late HealthKit
        // stored it.
        //
        // A subscriber that wants what came before has `queryHealthSamples` for
        // it — a subscription that replayed history would also hand a screen a
        // thousand-row first push on a device with a few MB of headroom.
        let descriptor = HKAnchoredObjectQueryDescriptor(
            predicates: [
                .quantitySample(
                    type: type,
                    predicate: HKQuery.predicateForSamples(
                        withStart: Date(), end: nil))
            ],
            anchor: nil,
            // No `limit`. Apple documents it as "the maximum number of samples
            // that the QUERY returns" — a total, not a page — so a limit on a
            // long-running stream would end it silently after N samples, which
            // is the one failure mode a live screen cannot notice.
            limit: nil)
        // Isolated to the main actor by inheritance (this bridge is
        // `@MainActor`), which is how the OFF-MAIN hazard is answered: HealthKit
        // produces these elements on its own queue, and every `await` here
        // resumes back on main, so `onSamples`, `wantedUpdates` and
        // `updateTasks` are only ever touched from the thread that owns them. It
        // is why this uses the descriptor's AsyncSequence rather than
        // `HKAnchoredObjectQuery`'s `updateHandler`, which would need
        // WorkoutBridge's `nonisolated(unsafe)` hop per callback.
        // COALESCED by MERGING, not by dropping and not by pacing. Every push is
        // a bridge crossing plus a synchronous React commit (`runSync`), so an
        // uncoalesced stream re-renders at sample rate — the cost
        // `workout.metrics` already coalesces against. Two differences from
        // `emitMetricsIfDue`, and this buffer is what both need:
        //
        // Metrics are level state, so dropping a too-early one loses nothing; a
        // sample stream is edge-triggered and a dropped batch is data the caller
        // can never get back. So a batch inside the floor is HELD, and this
        // bridge holds it — sleeping inside the `for try await` instead would
        // leave the batch unconsumed inside Apple's sequence, whose buffering
        // policy is documented nowhere, and the never-drop promise would be
        // HealthKit's to keep rather than ours.
        //
        // And holding is not the same as pacing: N batches that land inside one
        // floor merge into ONE push here, where sleeping between iterations
        // would have made them N pushes a floor apart — the same render cost the
        // knob was raised to avoid, plus a backlog that grows without bound. The
        // buffer is a local, so its lifetime is the query's: nothing to clear on
        // a stop, and no per-kind map to leak.
        let buffer = UpdateBuffer()
        updateTasks[kind] = Task { [weak self] in
            // Cancelling the flush makes it fire EARLY, not never: its sleep is
            // `try?`, so cancellation drops it straight through to the epoch
            // guard. Which is the behaviour both endings want — a stream
            // HealthKit dropped still delivers what it was holding, while a
            // stop, pause or teardown has moved the epoch and the guard eats it.
            defer { buffer.flush?.cancel() }
            do {
                for try await update in descriptor.results(for: store) {
                    // No checkpoint otherwise when `minIntervalMs` is 0 (legal,
                    // and it means "every batch, as it lands"): the emit path
                    // below never suspends, so a cancelled task would keep
                    // draining Apple's sequence until it ended on its own.
                    try Task.checkCancellation()
                    // OLDEST FIRST, sorted here rather than assumed: Apple
                    // promises `addedSamples` no order, so the LAST row — the
                    // newest value, which is the whole point for a heart rate —
                    // would be right only by luck.
                    let rows = update.addedSamples
                        .sorted { $0.startDate < $1.startDate }
                        .map { sample in
                            [
                                // The identity a deletion below retracts by —
                                // HKObject.uuid, the same accessor the
                                // queryHealthSamples row reads, because the
                                // two rows are the same shape by contract.
                                "id": sample.uuid.uuidString,
                                "startMs": sample.startDate.timeIntervalSince1970 * 1000,
                                "endMs": sample.endDate.timeIntervalSince1970 * 1000,
                                "value": sample.quantity.doubleValue(for: unit),
                                // The same unit the one-shot reads report, from
                                // the same table: a screen that reads a total
                                // once and then streams must not have its
                                // numbers change meaning halfway.
                                "unit": unitName,
                            ] as [String: Any]
                        }
                    // DELETIONS ride too (`healthUpdateDeletions`, taken
                    // 2026-08-22): a user deleting a sample in the Health app
                    // while a live screen is open is a retraction that screen's
                    // buffer needs, and dropping it was only honest while the
                    // row carried no identity to act on.
                    let deleted = update.deletedObjects.map(\.uuid.uuidString)
                    // An update carrying NEITHER new samples nor deletions is
                    // not pushed: an empty batch would wake every subscriber
                    // and commit a render to say nothing happened.
                    guard !rows.isEmpty || !deleted.isEmpty else { continue }
                    // THIS task's identity, checked before anything is emitted
                    // or buffered. `wantedUpdates` cannot answer it: a
                    // background pause deliberately LEAVES that entry set, so a
                    // batch already in flight would push into an app nobody can
                    // see, and a stop-then-restart would make it push alongside
                    // the new stream. The epoch moves on every stop, pause,
                    // teardown and supersession, so it is the one condition that
                    // covers all of them — and it does not depend on Apple
                    // observing cancellation promptly.
                    guard let self, self.updateEpochs[kind] == epoch else { return }
                    // Deletions share the buffer, and therefore the floor and
                    // the merge, so ORDER survives coalescing: an add and its
                    // own deletion held into one push net out to gone on the
                    // subscriber's side (JS applies samples first, then
                    // deletions), where an immediate deletions bypass could
                    // retract a row whose add was still being held.
                    buffer.rows.append(contentsOf: rows)
                    buffer.deletedIds.append(contentsOf: deleted)
                    let sinceLastPush = Date().timeIntervalSince(
                        buffer.lastEmitAt)
                    let wait = minGapSeconds - sinceLastPush
                    guard wait > 0 else {
                        buffer.lastEmitAt = Date()
                        let batch = buffer.take()
                        self.onSamples?(event, batch.rows, batch.deletedIds)
                        continue
                    }
                    // Inside the floor: a flush is already scheduled, or one is
                    // scheduled now. Either way this batch rides it, and the
                    // loop goes straight back to consuming.
                    guard buffer.flush == nil else { continue }
                    buffer.flush = Task { [weak self] in
                        try? await Task.sleep(
                            nanoseconds: UInt64(wait * 1_000_000_000))
                        guard let self, self.updateEpochs[kind] == epoch else { return }
                        buffer.flush = nil
                        // Empty when the loop's fast path already took these
                        // rows — the floor can elapse while this flush is still
                        // pending. Nothing to push, and `lastEmitAt` must not
                        // move for a push that did not happen, or the next real
                        // batch waits an extra floor for nothing.
                        let merged = buffer.take()
                        guard !merged.rows.isEmpty || !merged.deletedIds.isEmpty
                        else { return }
                        buffer.lastEmitAt = Date()
                        self.onSamples?(event, merged.rows, merged.deletedIds)
                    }
                }
            } catch {
                // Cancellation (a stop, a background pause, a reload) and a
                // HealthKit failure land here alike. Neither has anywhere to be
                // reported: the invoke that started this stream settled long
                // ago, and the caller asked for samples, not for a stream that
                // rejects at an arbitrary later moment. The stream simply ends;
                // `wantedUpdates` still says what should be running, so the next
                // foreground brings back what a pause took down.
            }
            // The stream is over — cancelled, or ended by HealthKit. Clearing
            // the handle is what makes the second case RECOVERABLE: `wanted`
            // with no task is the state the foreground resume re-arms, so a
            // stream Apple dropped comes back the way the heart-rate pump does
            // rather than staying dead until the next reload. Guarded by the
            // epoch so a task that was cancelled to make room for a newer one
            // cannot clear ITS handle on the way out.
            guard let self, self.updateEpochs[kind] == epoch else { return }
            self.updateTasks[kind] = nil
        }
    }

    /// Ends one type's stream. Never refuses: it is called from an effect
    /// CLEANUP, where a rejection has no caller left to handle it, and stopping
    /// a stream that is already stopped is the outcome the caller asked for.
    func stopUpdates(_ plan: HealthUpdatesStopPlan) {
        stopQuery(plan.kind)
    }

    private func stopQuery(_ kind: HealthQuantityKind) {
        // The epoch moves on a STOP too, so a start still inside its
        // authorization window resumes to find itself superseded and arms
        // nothing.
        updateEpochs[kind] = (updateEpochs[kind] ?? 0) + 1
        wantedUpdates[kind] = nil
        updateTasks.removeValue(forKey: kind)?.cancel()
    }

    /// Every stream down, and the desired state with it — the reload path
    /// (CX-008). The push channel is name-routed with NO generation guard, so a
    /// query that outlived `tearDownGeneration()` would deliver
    /// `health.samples.*` into the runtime `boot()` is about to install, which
    /// never subscribed to anything. `sensors.stopAll()`'s reason, for the one
    /// stream that is not a sensor.
    func stopAllUpdates() {
        for (_, task) in updateTasks { task.cancel() }
        updateTasks.removeAll()
        wantedUpdates.removeAll()
        // Not reset per kind: a start still inside its authorization window has
        // to find its epoch moved, and `updateEpochs` is the only thing that
        // outlives the maps it is guarding.
        updateEpochs = updateEpochs.mapValues { $0 + 1 }
    }

    /// scenePhase -> .background. A backgrounded app is not unmounted, so JS
    /// effect cleanups never fire and native owns the policy — the P0-3 rule the
    /// heart-rate pump already lives by.
    ///
    /// This feature is FOREGROUND-ONLY by design: Apple requires
    /// `enableBackgroundDelivery` and the background-delivery entitlement for
    /// updates to reach a suspended app, and this package asks for neither, so a
    /// query left armed here would deliver nothing while the app is away and
    /// wake it for nothing when it returns. The desired state SURVIVES (the
    /// `wantedUpdates` entries stay), which is what makes the resume a restart
    /// rather than a guess.
    func pauseUpdatesForBackground() {
        isBackgrounded = true
        for (kind, task) in updateTasks {
            // Superseded, not just cancelled. `Task.cancel()` is not synchronous
            // with the iterator finishing, so a batch already in flight would
            // otherwise push into an app nobody can see — and the emit guard
            // cannot ask `wantedUpdates`, which this pause deliberately keeps.
            // Moving the epoch is what makes that in-flight batch a no-op.
            updateEpochs[kind] = (updateEpochs[kind] ?? 0) + 1
            task.cancel()
        }
        updateTasks.removeAll()
    }

    /// scenePhase -> .active: re-arm every stream the app still wants.
    ///
    /// Each one comes back with a FRESH anchor and a fresh `Date()` predicate,
    /// so samples HealthKit saved while the app was away are not delivered. That
    /// is the honest behaviour for an edge-triggered stream, not a gap to
    /// paper over: those samples happened while nothing was rendering, and a
    /// screen that needs the current total re-reads it with
    /// `queryHealthStatistics` on the same foreground — which is what its JSDoc
    /// tells a caller to do.
    func resumeUpdatesFromForeground() {
        isBackgrounded = false
        for (_, plan) in wantedUpdates { startQuery(plan) }
    }

    /// JSON for an already-JSON-safe object/array (numbers, strings, NSNull).
    private static func json(_ value: Any) -> String {
        (try? JSONSerialization.data(withJSONObject: value))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "null"
    }
}

/// One live query's coalescing state: the rows and deletion ids waiting for
/// the next push, when the last one went out, and the flush that will send
/// them.
///
/// A reference type so the query's loop and its scheduled flush share ONE
/// buffer — captured `var`s cannot be, and a per-kind map on the bridge would
/// have to be cleared on every stop, pause and teardown path to avoid holding
/// samples nobody will ever receive. Owned by the query task instead, so it
/// dies exactly when the query does.
///
/// `@MainActor` explicitly: a nested/file-scope type does not inherit the
/// bridge's isolation, and both writers are main-confined.
@MainActor private final class UpdateBuffer {
    var rows: [[String: Any]] = []
    var deletedIds: [String] = []
    var lastEmitAt = Date.distantPast
    var flush: Task<Void, Never>?

    /// The held batch, and the buffer is empty again — one call, so a push can
    /// never send rows it also leaves behind. Both halves together, or a flush
    /// racing the fast path could split an add from the deletion that retracts
    /// it and deliver them out of order.
    func take() -> (rows: [[String: Any]], deletedIds: [String]) {
        defer {
            rows = []
            deletedIds = []
        }
        return (rows, deletedIds)
    }
}
#endif
