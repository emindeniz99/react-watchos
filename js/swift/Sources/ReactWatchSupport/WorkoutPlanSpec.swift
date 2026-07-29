import Foundation

/// The WorkoutKit plan contract for js/src/workoutPlans.ts — the half that is
/// decidable without WorkoutKit, so it is decided here and unit-tested on Linux
/// (`WorkoutPlanBridge` is `#if os(watchOS)` and unreachable under `swift test`).
///
/// **Nothing in this file may be named `WorkoutPlan`.** WorkoutKit's own
/// top-level type is `WorkoutPlan`, `WorkoutPlanBridge.swift` does
/// `import WorkoutKit`, and the sibling `WorkoutPlan.swift` in this module
/// already holds the live-session types. A `WorkoutPlan` here would be
/// ambiguous inside the one file that must resolve Apple's. Hence `Spec`
/// everywhere a `Plan` suffix would otherwise be the house convention
/// (`HealthStatisticsPlan`, `WorkoutStartPlan`, `CalendarEventsPlan`).
///
/// What is NOT decided here, deliberately: whether a given activity × location
/// × goal × alert combination is LEGAL. That matrix is documented nowhere and
/// is not stable (energy goals are silently illegal on a custom workout; pace
/// alerts are illegal for indoor running), and WorkoutKit ships
/// `supportsActivity`/`supportsGoal`/`supportsAlert` for exactly that question.
/// Hard-coding it here would be a second source of truth that could only ever
/// drift — so the bridge ASKS Apple before building the plan, and this file
/// only proves the request is structurally coherent.

/// Which WorkoutKit workout a spec builds. Keep in sync with the `kind` union
/// on `WorkoutPlanRequest` in js/codegen/schema.ts (codegen.test.ts pins them).
///
/// `swimBikeRun` is deliberately absent: no consumer in the prior-art survey
/// ships multisport, and adding it later is one `kind` value plus one array
/// field — additive, so it invalidates no shipped fixture.
public enum WorkoutPlanSpecKind: String, CaseIterable, Sendable {
    case custom
    case singleGoal
    case pacer
}

/// `WorkoutGoal`. The four cases at the watchOS 10.0 floor;
/// `poolSwimDistanceWithTime` is watchOS 11.0 and cut to keep this package
/// gate-free. Keep in sync with the `kind` union on `WorkoutPlanGoalRequest`.
public enum WorkoutPlanGoalKind: String, CaseIterable, Sendable {
    case open
    case distance
    case time
    case energy
}

/// The nine `WorkoutAlert` conformers, all watchOS 10.0 — none of them is cut.
/// What IS cut is the POWER alerts' current-vs-average selector, which is
/// watchOS 10.4 (see `WorkoutPlanAlertMetric`).
/// Keep in sync with the `kind` union on `WorkoutPlanAlertRequest`.
public enum WorkoutPlanAlertKind: String, CaseIterable, Sendable {
    case heartRateRange
    case heartRateZone
    case speedRange
    case speedThreshold
    case cadenceRange
    case cadenceThreshold
    case powerRange
    case powerThreshold
    case powerZone
}

/// `IntervalStep.Purpose`. Keep in sync with the `purpose` union on
/// `WorkoutPlanStepRequest`.
public enum WorkoutPlanStepPurpose: String, CaseIterable, Sendable {
    case work
    case recovery
}

/// `WorkoutAlertMetric` — current-vs-average, for the SPEED alerts only.
///
/// The asymmetry is Apple's, and it is the reason this enum exists at all:
/// `WorkoutAlert.speed(_:unit:metric:)` takes it at watchOS **10.0**, while the
/// power equivalent (`power(_:unit:metric:)`) is watchOS **10.4**. Exposing the
/// speed selector is free at this package's floor; exposing the power one would
/// be its first `@available` gate, so the power alerts ship through the 10.0
/// `power(_:unit:)` form and only their selector waits (`workoutPlanPowerMetric`).
/// Keep in sync with the `metric` union on `WorkoutPlanAlertRequest`.
public enum WorkoutPlanAlertMetric: String, CaseIterable, Sendable {
    case current
    case average
}

/// A validated goal. The unit is FIXED by `kind` (meters / seconds /
/// kilocalories) and named in the wire field, never carried as a unit string —
/// the shipped units-fixed-natively rule.
public struct WorkoutPlanGoalSpec: Equatable, Sendable {
    public let kind: WorkoutPlanGoalKind
    /// Meters, seconds or kilocalories per `kind`; nil for `.open`.
    public let value: Double?
}

/// A validated alert. Exactly one of the three carriers is set, per `kind`:
/// `lower`+`upper` for a range, `threshold` for a threshold, `zone` for a zone.
/// Units are fixed by `kind` — bpm, meters per second, counts per minute, watts.
public struct WorkoutPlanAlertSpec: Equatable, Sendable {
    public let kind: WorkoutPlanAlertKind
    public let lower: Double?
    public let upper: Double?
    public let threshold: Double?
    public let zone: Int?
    /// Speed alerts only — see `WorkoutPlanAlertMetric`. nil means Apple's own
    /// default, `.current`.
    public let metric: WorkoutPlanAlertMetric?
}

/// A validated `WorkoutStep`. `alert` is a single optional, not an array —
/// Apple's `WorkoutStep.alert` is `(any WorkoutAlert)?`.
///
/// `displayName` is absent on purpose: `WorkoutStep.displayName` is watchOS
/// 11.0 and would be this package family's first `@available` gate. Recorded as
/// the top follow-up (`workoutPlanStepNames`).
public struct WorkoutPlanStepSpec: Equatable, Sendable {
    public let goal: WorkoutPlanGoalSpec?
    public let alert: WorkoutPlanAlertSpec?
}

/// A validated `IntervalStep` — a step plus the work/recovery purpose only an
/// interval step carries.
public struct WorkoutPlanIntervalStepSpec: Equatable, Sendable {
    public let purpose: WorkoutPlanStepPurpose
    public let step: WorkoutPlanStepSpec
}

/// A validated `IntervalBlock`.
public struct WorkoutPlanBlockSpec: Equatable, Sendable {
    public let steps: [WorkoutPlanIntervalStepSpec]
    /// `IntervalBlock.iterations`, defaulted to Apple's own 1.
    public let iterations: Int
}

/// A validated workout plan: everything `WorkoutPlanBridge` needs to build a
/// `CustomWorkout` / `SingleGoalWorkout` / `PacerWorkout` and wrap it in a
/// `WorkoutPlan`, with the id it will be `Identifiable` by.
public struct WorkoutPlanSpec: Equatable, Sendable {
    public let kind: WorkoutPlanSpecKind
    /// `WorkoutPlan.id`. JS may supply it; a non-UUID string is REJECTED rather
    /// than silently replaced by a fresh random one, because scheduling,
    /// removal and completion all key on this id and a silent substitution
    /// would make `remove` a permanent no-op the caller cannot see.
    public let id: UUID
    /// Whether `id` came from the caller. Reported nowhere on the wire — the
    /// summary always echoes `id`, so a caller that omitted it learns the
    /// minted one — but it keeps `decode` honest about what it did.
    public let idWasSupplied: Bool
    /// The `HKWorkoutActivityType` case NAME. Not validated here: the only
    /// truthful check is "does this binary's enum have that case", and that is
    /// the generated `WorkoutActivityName` switch on the watch side. Re-listing
    /// 81 names here would be a second source of truth.
    public let activityType: String
    /// Absent maps to WorkoutKit's own `.unknown` default — NOT a third wire
    /// value. A caller who omits it gets Apple's default, which is what they
    /// mean.
    public let location: WorkoutLocation?
    /// `CustomWorkout.displayName` — custom workouts only; the other two
    /// initializers do not take one.
    public let displayName: String?
    public let warmup: WorkoutPlanStepSpec?
    public let blocks: [WorkoutPlanBlockSpec]
    public let cooldown: WorkoutPlanStepSpec?
    /// `SingleGoalWorkout.goal` — the ONE kind where an `energy` goal is legal.
    public let goal: WorkoutPlanGoalSpec?
    /// `PacerWorkout.distance` (meters) and `.time` (seconds).
    public let distanceMeters: Double?
    public let durationSeconds: Double?
}

// MARK: - Decoding

/// `.failure` with the message wrapped, so each rule below reads as one line.
/// `HealthRequestError` is reused rather than forked: it is this package's
/// invoke-request rejection type, and its message IS the INVALID_REQUEST reason.
private func invalid<T>(_ message: String) -> Result<T, HealthRequestError> {
    .failure(HealthRequestError(message))
}

private struct GoalPayload: Decodable {
    let kind: String?
    let meters: Double?
    let seconds: Double?
    let kilocalories: Double?
}

private struct AlertPayload: Decodable {
    let kind: String?
    let metric: String?
    let lowerBpm: Double?
    let upperBpm: Double?
    let zone: Int?
    let lowerMetersPerSecond: Double?
    let upperMetersPerSecond: Double?
    let metersPerSecond: Double?
    let lowerCountPerMinute: Double?
    let upperCountPerMinute: Double?
    let countPerMinute: Double?
    let lowerWatts: Double?
    let upperWatts: Double?
    let watts: Double?
}

private struct StepPayload: Decodable {
    let purpose: String?
    let goal: GoalPayload?
    let alert: AlertPayload?
}

private struct BlockPayload: Decodable {
    let steps: [StepPayload]?
    let iterations: Int?
}

private struct PlanPayload: Decodable {
    let kind: String?
    let id: String?
    let activityType: String?
    let location: String?
    let displayName: String?
    let warmup: StepPayload?
    let blocks: [BlockPayload]?
    let cooldown: StepPayload?
    let goal: GoalPayload?
    let distanceMeters: Double?
    let durationSeconds: Double?
}

private struct SchedulePayload: Decodable {
    let plan: PlanPayload?
    let atMs: Double?
}

private struct OpenPayload: Decodable {
    let plan: PlanPayload?
}

private struct RefPayload: Decodable {
    let id: String?
    let atMs: Double?
}

/// A finite, positive magnitude — the rule every goal value shares. A zero
/// distance goal is a workout that is complete before it starts, which Apple
/// would accept silently.
private func positive(
    _ value: Double?, _ path: String
) -> Result<Double, HealthRequestError> {
    guard let value, value.isFinite else {
        return invalid("\(path) must be a finite number")
    }
    guard value > 0 else { return invalid("\(path) must be greater than 0") }
    return .success(value)
}

/// A finite, non-negative magnitude — the rule every alert bound shares. Unlike
/// a goal, 0 is legal here: a `speedRange` starting at 0 m/s is a real "stay
/// under this pace" alert.
private func nonNegative(
    _ value: Double?, _ path: String
) -> Result<Double, HealthRequestError> {
    guard let value, value.isFinite else {
        return invalid("\(path) must be a finite number")
    }
    guard value >= 0 else { return invalid("\(path) must not be negative") }
    return .success(value)
}

/// Rejects a field that belongs to a DIFFERENT `kind`. The wire shape is flat
/// with a `kind` discriminator (a Swift enum-with-payload is not expressible in
/// the generated Codable structs), so nothing structural stops a caller sending
/// `goal` on a `pacer`. Silently ignoring it would build a workout the caller
/// did not describe.
private func absent(
    _ present: Bool, _ path: String, _ reason: String
) -> HealthRequestError? {
    present ? HealthRequestError("\(path) is not valid \(reason)") : nil
}

extension WorkoutPlanGoalSpec {
    fileprivate static func decode(
        _ payload: GoalPayload, _ path: String
    ) -> Result<WorkoutPlanGoalSpec, HealthRequestError> {
        guard let kind = payload.kind.flatMap(WorkoutPlanGoalKind.init(rawValue:))
        else {
            return invalid(
                "\(path).kind: unknown goal '\(payload.kind ?? "")' — expected one of "
                    + WorkoutPlanGoalKind.allCases.map(\.rawValue).joined(separator: ", "))
        }
        let carriers: [(WorkoutPlanGoalKind, String, Double?)] = [
            (.distance, "meters", payload.meters),
            (.time, "seconds", payload.seconds),
            (.energy, "kilocalories", payload.kilocalories),
        ]
        for (owner, field, value) in carriers where owner != kind {
            if let error = absent(
                value != nil, "\(path).\(field)", "for a '\(kind.rawValue)' goal")
            {
                return .failure(error)
            }
        }
        guard let (_, field, raw) = carriers.first(where: { $0.0 == kind }) else {
            // `.open` carries no magnitude, and must not be given one.
            return .success(WorkoutPlanGoalSpec(kind: kind, value: nil))
        }
        return positive(raw, "\(path).\(field)").map {
            WorkoutPlanGoalSpec(kind: kind, value: $0)
        }
    }
}

extension WorkoutPlanAlertSpec {
    /// The wire field names each alert kind reads, in `(lower, upper)` /
    /// `(threshold)` / `(zone)` form. One table so the "belongs to another
    /// kind" rejection below and the value read below cannot disagree.
    fileprivate static func fields(
        for kind: WorkoutPlanAlertKind
    ) -> (lower: String, upper: String)? {
        switch kind {
        case .heartRateRange: ("lowerBpm", "upperBpm")
        case .speedRange: ("lowerMetersPerSecond", "upperMetersPerSecond")
        case .cadenceRange: ("lowerCountPerMinute", "upperCountPerMinute")
        case .powerRange: ("lowerWatts", "upperWatts")
        case .heartRateZone, .powerZone: nil
        case .speedThreshold, .cadenceThreshold, .powerThreshold: nil
        }
    }

    fileprivate static func decode(
        _ payload: AlertPayload, _ path: String
    ) -> Result<WorkoutPlanAlertSpec, HealthRequestError> {
        guard let kind = payload.kind.flatMap(WorkoutPlanAlertKind.init(rawValue:))
        else {
            return invalid(
                "\(path).kind: unknown alert '\(payload.kind ?? "")' — expected one of "
                    + WorkoutPlanAlertKind.allCases.map(\.rawValue).joined(separator: ", "))
        }
        // Every carrier field, with the kind that owns it. Anything set that
        // this kind does not own is rejected rather than ignored.
        let carriers: [(WorkoutPlanAlertKind, String, Double?)] = [
            (.heartRateRange, "lowerBpm", payload.lowerBpm),
            (.heartRateRange, "upperBpm", payload.upperBpm),
            (.speedRange, "lowerMetersPerSecond", payload.lowerMetersPerSecond),
            (.speedRange, "upperMetersPerSecond", payload.upperMetersPerSecond),
            (.speedThreshold, "metersPerSecond", payload.metersPerSecond),
            (.cadenceRange, "lowerCountPerMinute", payload.lowerCountPerMinute),
            (.cadenceRange, "upperCountPerMinute", payload.upperCountPerMinute),
            (.cadenceThreshold, "countPerMinute", payload.countPerMinute),
            (.powerRange, "lowerWatts", payload.lowerWatts),
            (.powerRange, "upperWatts", payload.upperWatts),
            (.powerThreshold, "watts", payload.watts),
        ]
        for (owner, field, value) in carriers where owner != kind {
            if let error = absent(
                value != nil, "\(path).\(field)", "for a '\(kind.rawValue)' alert")
            {
                return .failure(error)
            }
        }
        // The current-vs-average selector is SPEED-only at this floor — the
        // power one is watchOS 10.4 and cut. Sending it to any other kind is
        // refused rather than dropped, so a caller asking for average power
        // learns it did not happen.
        let speedAlert = kind == .speedRange || kind == .speedThreshold
        var metric: WorkoutPlanAlertMetric?
        if let raw = payload.metric {
            if let error = absent(
                !speedAlert, "\(path).metric",
                "for a '\(kind.rawValue)' alert — only the speed alerts take one at "
                    + "watchOS 10.0")
            {
                return .failure(error)
            }
            guard let parsed = WorkoutPlanAlertMetric(rawValue: raw) else {
                return invalid(
                    "\(path).metric: unknown metric '\(raw)' — expected one of "
                        + WorkoutPlanAlertMetric.allCases.map(\.rawValue)
                        .joined(separator: ", "))
            }
            metric = parsed
        }
        let zoned = kind == .heartRateZone || kind == .powerZone
        if let error = absent(
            !zoned && payload.zone != nil, "\(path).zone",
            "for a '\(kind.rawValue)' alert")
        {
            return .failure(error)
        }
        if zoned {
            guard let zone = payload.zone else {
                return invalid("\(path).zone is required for '\(kind.rawValue)'")
            }
            // 1-based, and that is the only bound this file can honestly
            // assert: Apple documents no ceiling for either zone family, so
            // inventing one would be the second-source-of-truth this design
            // exists to avoid.
            guard zone >= 1 else { return invalid("\(path).zone must be 1 or greater") }
            return .success(
                WorkoutPlanAlertSpec(
                    kind: kind, lower: nil, upper: nil, threshold: nil, zone: zone,
                    metric: nil))
        }
        if let range = fields(for: kind) {
            let lower = nonNegative(
                carriers.first { $0.1 == range.lower }?.2, "\(path).\(range.lower)")
            let upper = nonNegative(
                carriers.first { $0.1 == range.upper }?.2, "\(path).\(range.upper)")
            return lower.flatMap { low in
                upper.flatMap { high in
                    guard low <= high else {
                        return invalid(
                            "\(path).\(range.lower) (\(low)) must not exceed "
                                + "\(path).\(range.upper) (\(high))")
                    }
                    return .success(
                        WorkoutPlanAlertSpec(
                            kind: kind, lower: low, upper: high, threshold: nil,
                            zone: nil, metric: metric))
                }
            }
        }
        guard let (_, field, raw) = carriers.first(where: { $0.0 == kind }) else {
            return invalid("\(path): '\(kind.rawValue)' has no value carrier")
        }
        return nonNegative(raw, "\(path).\(field)").map {
            WorkoutPlanAlertSpec(
                kind: kind, lower: nil, upper: nil, threshold: $0, zone: nil,
                metric: metric)
        }
    }
}

extension WorkoutPlanStepSpec {
    fileprivate static func decode(
        _ payload: StepPayload, _ path: String, interval: Bool
    ) -> Result<WorkoutPlanStepSpec, HealthRequestError> {
        if let error = absent(
            !interval && payload.purpose != nil, "\(path).purpose",
            "outside an interval block — only a block's steps have a work/recovery purpose"
        ) {
            return .failure(error)
        }
        var goal: WorkoutPlanGoalSpec?
        if let raw = payload.goal {
            switch WorkoutPlanGoalSpec.decode(raw, "\(path).goal") {
            case .failure(let error): return .failure(error)
            case .success(let value): goal = value
            }
        }
        var alert: WorkoutPlanAlertSpec?
        if let raw = payload.alert {
            switch WorkoutPlanAlertSpec.decode(raw, "\(path).alert") {
            case .failure(let error): return .failure(error)
            case .success(let value): alert = value
            }
        }
        return .success(WorkoutPlanStepSpec(goal: goal, alert: alert))
    }
}

extension WorkoutPlanBlockSpec {
    fileprivate static func decode(
        _ payload: BlockPayload, _ path: String
    ) -> Result<WorkoutPlanBlockSpec, HealthRequestError> {
        let steps = payload.steps ?? []
        guard !steps.isEmpty else {
            return invalid("\(path).steps must contain at least one step")
        }
        let iterations = payload.iterations ?? 1
        guard iterations >= 1 else {
            return invalid("\(path).iterations must be 1 or greater")
        }
        var decoded: [WorkoutPlanIntervalStepSpec] = []
        for (index, step) in steps.enumerated() {
            let stepPath = "\(path).steps[\(index)]"
            guard
                let purpose = step.purpose.flatMap(
                    WorkoutPlanStepPurpose.init(rawValue:))
            else {
                return invalid(
                    "\(stepPath).purpose: unknown purpose '\(step.purpose ?? "")' — "
                        + "expected one of "
                        + WorkoutPlanStepPurpose.allCases.map(\.rawValue)
                        .joined(separator: ", "))
            }
            switch WorkoutPlanStepSpec.decode(step, stepPath, interval: true) {
            case .failure(let error): return .failure(error)
            case .success(let value):
                decoded.append(
                    WorkoutPlanIntervalStepSpec(purpose: purpose, step: value))
            }
        }
        return .success(
            WorkoutPlanBlockSpec(steps: decoded, iterations: iterations))
    }
}

extension WorkoutPlanSpec {
    /// The plan object itself, validated. `path` prefixes every message so a
    /// caller reading the INVALID_REQUEST reason knows which element failed —
    /// `plan.blocks[2].steps[0].alert.upperBpm`, not "bad request".
    fileprivate static func decode(
        _ payload: PlanPayload, _ path: String
    ) -> Result<WorkoutPlanSpec, HealthRequestError> {
        guard let kind = payload.kind.flatMap(WorkoutPlanSpecKind.init(rawValue:))
        else {
            return invalid(
                "\(path).kind: unknown plan kind '\(payload.kind ?? "")' — expected one of "
                    + WorkoutPlanSpecKind.allCases.map(\.rawValue).joined(separator: ", "))
        }
        guard let activityType = payload.activityType, !activityType.isEmpty else {
            return invalid("\(path).activityType is required")
        }
        var id = UUID()
        let idWasSupplied = payload.id != nil
        if let raw = payload.id {
            guard let parsed = UUID(uuidString: raw) else {
                return invalid(
                    "\(path).id '\(raw)' is not a UUID — WorkoutPlan.id is a UUID and "
                        + "scheduling, listing and removal all key on it")
            }
            id = parsed
        }
        var location: WorkoutLocation?
        if let name = payload.location {
            guard let parsed = WorkoutLocation(rawValue: name) else {
                return invalid(
                    "\(path).location: unknown location '\(name)' — expected indoor or outdoor"
                )
            }
            location = parsed
        }
        // Fields that belong to exactly one kind. Sending one to another kind
        // is a caller bug, not a field to ignore.
        let owned: [(WorkoutPlanSpecKind, String, Bool)] = [
            (.custom, "displayName", payload.displayName != nil),
            (.custom, "warmup", payload.warmup != nil),
            (.custom, "blocks", payload.blocks != nil),
            (.custom, "cooldown", payload.cooldown != nil),
            (.singleGoal, "goal", payload.goal != nil),
            (.pacer, "distanceMeters", payload.distanceMeters != nil),
            (.pacer, "durationSeconds", payload.durationSeconds != nil),
        ]
        for (owner, field, present) in owned where owner != kind {
            if let error = absent(
                present, "\(path).\(field)",
                "for a '\(kind.rawValue)' plan — it belongs to '\(owner.rawValue)'")
            {
                return .failure(error)
            }
        }
        var warmup: WorkoutPlanStepSpec?
        var cooldown: WorkoutPlanStepSpec?
        var blocks: [WorkoutPlanBlockSpec] = []
        var goal: WorkoutPlanGoalSpec?
        var distanceMeters: Double?
        var durationSeconds: Double?
        switch kind {
        case .custom:
            let rawBlocks = payload.blocks ?? []
            // An interval block IS the reason a custom workout exists —
            // TrainingPeaks rejects unstructured plans outright, and a custom
            // workout with no blocks is a `singleGoal` wearing the wrong kind.
            guard !rawBlocks.isEmpty else {
                return invalid(
                    "\(path).blocks must contain at least one interval block — a custom "
                        + "workout with no blocks is a 'singleGoal' plan")
            }
            for (index, block) in rawBlocks.enumerated() {
                switch WorkoutPlanBlockSpec.decode(block, "\(path).blocks[\(index)]") {
                case .failure(let error): return .failure(error)
                case .success(let value): blocks.append(value)
                }
            }
            if let raw = payload.warmup {
                switch WorkoutPlanStepSpec.decode(raw, "\(path).warmup", interval: false) {
                case .failure(let error): return .failure(error)
                case .success(let value): warmup = value
                }
            }
            if let raw = payload.cooldown {
                switch WorkoutPlanStepSpec.decode(raw, "\(path).cooldown", interval: false) {
                case .failure(let error): return .failure(error)
                case .success(let value): cooldown = value
                }
            }
        case .singleGoal:
            guard let raw = payload.goal else {
                return invalid("\(path).goal is required for a 'singleGoal' plan")
            }
            switch WorkoutPlanGoalSpec.decode(raw, "\(path).goal") {
            case .failure(let error): return .failure(error)
            case .success(let value): goal = value
            }
        case .pacer:
            switch positive(payload.distanceMeters, "\(path).distanceMeters") {
            case .failure(let error): return .failure(error)
            case .success(let value): distanceMeters = value
            }
            switch positive(payload.durationSeconds, "\(path).durationSeconds") {
            case .failure(let error): return .failure(error)
            case .success(let value): durationSeconds = value
            }
        }
        return .success(
            WorkoutPlanSpec(
                kind: kind, id: id, idWasSupplied: idWasSupplied,
                activityType: activityType, location: location,
                displayName: payload.displayName, warmup: warmup, blocks: blocks,
                cooldown: cooldown, goal: goal, distanceMeters: distanceMeters,
                durationSeconds: durationSeconds))
    }

    /// A validated `openWorkoutPlanInWorkoutApp` payload (`{ plan }`).
    public static func decodeOpen(
        json: String
    ) -> Result<WorkoutPlanSpec, HealthRequestError> {
        guard
            let payload = try? JSONDecoder().decode(
                OpenPayload.self, from: Data(json.utf8)), let plan = payload.plan
        else {
            return invalid("openWorkoutPlanInWorkoutApp needs a { plan } object")
        }
        return decode(plan, "plan")
    }
}

/// A validated `scheduleWorkoutPlan` request: the plan plus the instant it is
/// scheduled at.
public struct WorkoutPlanScheduleSpec: Equatable, Sendable {
    public let plan: WorkoutPlanSpec
    /// Absolute ms since epoch, as sent. The `DateComponents` WorkoutKit keys
    /// on is derived from it through `WorkoutPlanSchedule`, never stored twice.
    public let atMs: Double

    public static func decode(
        json: String
    ) -> Result<WorkoutPlanScheduleSpec, HealthRequestError> {
        guard
            let payload = try? JSONDecoder().decode(
                SchedulePayload.self, from: Data(json.utf8)), let plan = payload.plan
        else {
            return invalid("scheduleWorkoutPlan needs a { plan, atMs } object")
        }
        return WorkoutPlanSchedule.validate(atMs: payload.atMs).flatMap { atMs in
            WorkoutPlanSpec.decode(plan, "plan").map {
                WorkoutPlanScheduleSpec(plan: $0, atMs: atMs)
            }
        }
    }
}

/// A validated `removeScheduledWorkoutPlan` request — the `(id, date)` pair
/// WorkoutKit keys a scheduled plan on. The whole plan is never re-sent: the
/// bridge resolves the real `WorkoutPlan` out of `scheduledWorkouts`, so there
/// is no client-side plan store to go stale.
public struct ScheduledWorkoutRefSpec: Equatable, Sendable {
    public let id: UUID
    public let atMs: Double

    public static func decode(
        json: String
    ) -> Result<ScheduledWorkoutRefSpec, HealthRequestError> {
        guard
            let payload = try? JSONDecoder().decode(
                RefPayload.self, from: Data(json.utf8))
        else {
            return invalid("removeScheduledWorkoutPlan needs an { id, atMs } object")
        }
        guard let raw = payload.id, let id = UUID(uuidString: raw) else {
            return invalid(
                "removeScheduledWorkoutPlan needs `id` as a UUID — got "
                    + "'\(payload.id ?? "")'")
        }
        return WorkoutPlanSchedule.validate(atMs: payload.atMs).map {
            ScheduledWorkoutRefSpec(id: id, atMs: $0)
        }
    }
}

/// The `atMs` <-> `DateComponents` round trip, as ONE pure pair.
///
/// `WorkoutScheduler.schedule(_:at:)`, `.remove(_:at:)` and every entry in
/// `scheduledWorkouts` key on `DateComponents`, while every other time on this
/// bridge is absolute ms since epoch (`ScheduleNotificationRequest.at`, the
/// health windows). Both directions live here, take the `Calendar` as a
/// PARAMETER rather than reading `Calendar.current`, and are therefore
/// deterministic and Linux-unit-testable — which is rare for anything in this
/// family and is the reason the conversion is not written inline in the bridge.
///
/// **Granularity is one minute.** The field set is fixed at
/// year/month/day/hour/minute, which is what makes `remove` match `schedule` by
/// construction — but it also means a caller who schedules at `…:30.500` and
/// then lists gets `…:30.000` back.
public enum WorkoutPlanSchedule {
    /// The exact `DateComponents` field set every scheduling call uses.
    public static let fields: Set<Calendar.Component> = [
        .year, .month, .day, .hour, .minute,
    ]

    /// Sanity bound on `atMs`, ~year 3000. Not a scheduling policy — the
    /// scheduler's own visibility window is ±7 days — but a guard rail:
    /// `Date(timeIntervalSince1970:)` accepts any finite Double and handing a
    /// `1e300` one to `Calendar` is a crash on the invoke dispatch path rather
    /// than the refusal every other rule in this family produces. The same
    /// reasoning as `HealthWindow.dayCount`'s saturation.
    public static let maxAtMs: Double = 32_503_680_000_000

    static func validate(atMs: Double?) -> Result<Double, HealthRequestError> {
        guard let atMs, atMs.isFinite else {
            return invalid("atMs is required, a finite ms since epoch")
        }
        guard abs(atMs) <= maxAtMs else {
            return invalid(
                "atMs (\(atMs)) is outside the supported range ±\(maxAtMs)")
        }
        return .success(atMs)
    }

    /// ms since epoch -> the components WorkoutKit keys on.
    public static func components(
        fromMs ms: Double, calendar: Calendar
    ) -> DateComponents {
        calendar.dateComponents(
            fields, from: Date(timeIntervalSince1970: ms / 1000))
    }

    /// The inverse, for `listScheduledWorkoutPlans`. `nil` when the calendar
    /// cannot build a date from the components — reported as an omitted entry
    /// rather than a guessed timestamp.
    public static func milliseconds(
        from components: DateComponents, calendar: Calendar
    ) -> Double? {
        calendar.date(from: components).map { $0.timeIntervalSince1970 * 1000 }
    }

    /// The round trip COMPOSED: `ms -> components -> ms`, i.e. the instant
    /// truncated to the minute the scheduler actually keys on.
    ///
    /// This is what the bridge compares on read-back, rather than
    /// `DateComponents ==`: Apple may normalise the components it stores (an
    /// era, a calendar, a time zone we never set), and a raw equality would
    /// then be a false negative that reads to the caller as "the scheduler
    /// accepted nothing". Composing the pair also makes the identity the
    /// scheduler uses a thing `swift test` can assert on Linux.
    public static func minuteMs(fromMs ms: Double, calendar: Calendar) -> Double? {
        milliseconds(
            from: components(fromMs: ms, calendar: calendar), calendar: calendar)
    }
}
