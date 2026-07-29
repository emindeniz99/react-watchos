// WorkoutKit plan composition + scheduling for js/src/workoutPlans.ts, routed
// through the invoke channel. watchOS-only, like the rest of ReactWatchHost, so
// every rule a malformed plan has to trip lives in ReactWatchSupport's
// WorkoutPlanSpec (Linux-tested) and this file only turns a VALIDATED spec into
// WorkoutKit types and talks to the scheduler.
//
// TWO PROPERTIES THIS FILE IS BUILT AROUND, both pinned by
// js/test/workout-plan-guards.test.ts because no Linux job can compile them:
//
// 1. IT IS STATELESS, and it must never touch `WorkoutSessionOwner`.
//    WorkoutKit is a DOCUMENT api: a WorkoutPlan is an immutable value, the
//    scheduler is a shared store of a handful of documents, and nothing runs.
//    There is no epoch, no claim, no parked settle, no teardown ordering, no
//    background mode — none of the machinery `WorkoutBridge.swift` exists for.
//    A file named `WorkoutPlanBridge` sitting next to `WorkoutBridge` is
//    exactly where a future contributor would wrongly reach for the single
//    HKWorkoutSession, so: one `WorkoutScheduler.shared` call per invoke, and
//    the single-construction-site invariant next door keeps holding.
//
// 2. EVERY MUTATION IS VERIFIED BY READ-BACK. Apple's mutating calls have NO
//    error channel at all:
//        final func schedule(_:at:) async        // no throws, no return
//        final func remove(_:at:) async          // no throws, no return
//        final func removeAllWorkouts() async    // no throws, no return
//    A naked `await schedule(...)` resolves identically whether the plan was
//    stored, whether the user denied authorization, whether the device is over
//    quota, and whether `isSupported` is false. That is the exact class of
//    dishonesty the health package spent four commits removing, so each mutator
//    re-reads `scheduledWorkouts` and settles only on what it finds there.
//
// UNVERIFIED ON ANY MACHINE IN THIS REPO: whether watch-side scheduling works
// end to end. Every WorkoutScheduler member is documented watchOS 10.0 with no
// caveat, but Apple's own sample schedules from iPhone and only READS on the
// watch, and `openInWorkoutApp()` is the one API that is watchOS+macOS and not
// iOS. Nothing contradicts watch-side scheduling; nothing confirms it either.
// The read-back above is what makes that honest at runtime instead of hopeful:
// if the scheduler accepts nothing, the invoke rejects UNAVAILABLE saying so.
// See docs/design-workout-plans.md §"the sim spike" for the next-Mac-session
// steps that settle it.
#if os(watchOS)
import Foundation
import HealthKit
import ReactWatchSupport
import WorkoutKit

/// One WorkoutKit bridge per host. `@MainActor` for the same reason as
/// `HealthQueryBridge` — the model that owns it is main-isolated, so there is
/// no hop — though unlike that one this bridge holds no mutable state at all.
@MainActor final class WorkoutPlanBridge {
    /// Settled outcome of one op, already serialized — the
    /// `HealthQueryBridge.Outcome` shape, split where WorkoutKit genuinely
    /// splits: a plan Apple's legality checks refused is INVALID_REQUEST (the
    /// caller changes code), a device or scheduler that said no is UNAVAILABLE
    /// (the caller cannot). There is deliberately no INTERNAL arm — every
    /// failure this bridge can observe is one of those two.
    enum Outcome {
        case ok(String)  // resultJson
        case invalid(String)  // INVALID_REQUEST — the request itself is wrong
        case unavailable(String)  // UNAVAILABLE — the device/scheduler said no
    }

    /// Whether this device supports scheduled workouts at all. A DEVICE
    /// capability answer, not an authorization one.
    static var isSupported: Bool { WorkoutScheduler.isSupported }

    // MARK: - Authorization

    /// Runs the scheduling permission sheet and reports a REAL verdict — the
    /// opposite of HealthKit's reads, where Apple states an app cannot know
    /// whether a read was granted. `WorkoutScheduler.requestAuthorization()` is
    /// non-throwing and returns an `AuthorizationState`.
    ///
    /// It reads `authorizationState` FIRST and prompts only on
    /// `.notDetermined`. The house contract (`requestCalendarAccess`) is that
    /// calling again returns the standing status without re-prompting — but
    /// Apple does not document whether `requestAuthorization()` re-prompts, and
    /// assuming it behaves like HealthKit is exactly the kind of guess this
    /// codebase keeps removing. Two lines make the contract true by
    /// construction instead.
    func requestAuthorization() async -> Outcome {
        guard Self.isSupported else { return .unavailable(Self.unsupportedMessage) }
        let scheduler = WorkoutScheduler.shared
        let standing = await scheduler.authorizationState
        guard standing == .notDetermined else {
            return .ok(Self.jsonString(Self.name(for: standing)))
        }
        let answered = await scheduler.requestAuthorization()
        return .ok(Self.jsonString(Self.name(for: answered)))
    }

    /// A state this binary doesn't know maps to `notDetermined` — literally
    /// "we cannot tell", which is the least-wrong of the four wire values. A
    /// fifth case would be a wire change, not a silent remap to `denied`.
    private static func name(
        for state: WorkoutScheduler.AuthorizationState
    ) -> String {
        switch state {
        case .authorized: "authorized"
        case .denied: "denied"
        case .notDetermined: "notDetermined"
        case .restricted: "restricted"
        @unknown default: "notDetermined"
        }
    }

    // MARK: - Scheduling

    /// Preflight → build → schedule → **read back** → settle.
    ///
    /// The quota is read from `WorkoutScheduler.maxAllowedScheduledWorkoutCount`
    /// at runtime and never hardcoded: its value is not in Apple's docs JSON at
    /// all, and the only public figure ("up to 15 workouts at a time") is a
    /// WWDC23 line three years old.
    func schedule(
        _ spec: WorkoutPlanScheduleSpec, calendar: Calendar
    ) async -> Outcome {
        guard Self.isSupported else { return .unavailable(Self.unsupportedMessage) }
        let plan: WorkoutPlan
        switch Self.plan(from: spec.plan) {
        case .failure(let error): return .invalid(error.message)
        case .success(let built): plan = built
        }
        let scheduler = WorkoutScheduler.shared
        let quota = WorkoutScheduler.maxAllowedScheduledWorkoutCount
        let existing = await scheduler.scheduledWorkouts
        // Refused BEFORE the mutation, naming the real numbers: `schedule` has
        // no error channel, so an over-quota call would otherwise be a silent
        // no-op the read-back could only report as "the scheduler accepted
        // nothing" — true, but useless.
        guard existing.count < quota else {
            return .invalid(
                "the scheduler already holds \(existing.count) of its \(quota) "
                    + "allowed scheduled workouts — remove one first")
        }
        let at = WorkoutPlanSchedule.components(fromMs: spec.atMs, calendar: calendar)
        await scheduler.schedule(plan, at: at)
        let stored = await scheduler.scheduledWorkouts
        guard
            let confirmed = stored.first(where: {
                Self.matches($0, id: plan.id, atMs: spec.atMs, calendar: calendar)
            }), let summary = Self.summary(confirmed, calendar: calendar)
        else {
            return .unavailable(Self.acceptedNothingMessage)
        }
        return .ok(Self.json(summary))
    }

    /// Everything the scheduler is holding. An entry whose `DateComponents`
    /// this calendar cannot turn back into an instant is DROPPED rather than
    /// reported with a guessed timestamp — the same posture the interpreters
    /// take for an unknown node type.
    func scheduledSummaries(calendar: Calendar) async -> Outcome {
        guard Self.isSupported else { return .unavailable(Self.unsupportedMessage) }
        let scheduled = await WorkoutScheduler.shared.scheduledWorkouts
        return .ok(
            Self.json(scheduled.compactMap { Self.summary($0, calendar: calendar) }))
    }

    /// Removes one scheduled plan by `(id, atMs)` and resolves whether it was
    /// there. The real `WorkoutPlan` is resolved out of `scheduledWorkouts`, so
    /// JS never re-sends a whole plan to delete one and there is no client-side
    /// plan store to go stale.
    ///
    /// An id that isn't scheduled resolves `false` rather than rejecting: a
    /// stale UI removing an already-completed plan is normal, not an error.
    func remove(
        _ ref: ScheduledWorkoutRefSpec, calendar: Calendar
    ) async -> Outcome {
        guard Self.isSupported else { return .unavailable(Self.unsupportedMessage) }
        let scheduler = WorkoutScheduler.shared
        let before = await scheduler.scheduledWorkouts
        guard
            let target = before.first(where: {
                Self.matches($0, id: ref.id, atMs: ref.atMs, calendar: calendar)
            })
        else { return .ok("false") }
        let at = WorkoutPlanSchedule.components(fromMs: ref.atMs, calendar: calendar)
        await scheduler.remove(target.plan, at: at)
        let after = await scheduler.scheduledWorkouts
        guard
            !after.contains(where: {
                Self.matches($0, id: ref.id, atMs: ref.atMs, calendar: calendar)
            })
        else {
            return .unavailable(
                "the scheduler removed nothing — the plan is still scheduled "
                    + "after remove(_:at:), which reports no error of its own")
        }
        return .ok("true")
    }

    /// The only recovery from a wedged list, and read-back verified for the
    /// same reason as the other two.
    func removeAll() async -> Outcome {
        guard Self.isSupported else { return .unavailable(Self.unsupportedMessage) }
        let scheduler = WorkoutScheduler.shared
        await scheduler.removeAllWorkouts()
        let after = await scheduler.scheduledWorkouts
        guard after.isEmpty else {
            return .unavailable(
                "the scheduler removed nothing — \(after.count) workout(s) are "
                    + "still scheduled after removeAllWorkouts()")
        }
        return .ok("null")
    }

    /// `WorkoutPlan.openInWorkoutApp()` — watchOS + macOS only, and the one API
    /// a standalone watch app is unambiguously the right caller for.
    ///
    /// It LAUNCHES the Workout app (it does not present a sheet over us — that
    /// is the iOS behavior), so our app leaves the foreground while the invoke
    /// is in flight, and Apple does not document when the call returns.
    /// `isSupported` is deliberately NOT checked here: that flag answers "does
    /// this device support SCHEDULED workouts", which is a different question
    /// from whether the Workout app can be handed a plan now.
    ///
    /// A throw maps to UNAVAILABLE carrying the error text rather than to a
    /// modeled `StateError`: its two cases (`watchNotPaired`,
    /// `workoutApplicationNotInstalled`) are structurally unreachable here —
    /// we ARE the watch, and Workout is a system app.
    func open(_ spec: WorkoutPlanSpec) async -> Outcome {
        switch Self.plan(from: spec) {
        case .failure(let error): return .invalid(error.message)
        case .success(let plan):
            do {
                try await plan.openInWorkoutApp()
                return .ok("null")
            } catch {
                return .unavailable(error.localizedDescription)
            }
        }
    }

    // MARK: - Read-back identity

    private static let unsupportedMessage =
        "this device does not support scheduled workouts "
        + "(WorkoutScheduler.isSupported is false)"

    private static let acceptedNothingMessage =
        "the scheduler accepted nothing — watch-side scheduling may be "
        + "unsupported on this configuration"

    /// Whether a scheduled entry IS the `(id, instant)` pair we asked about.
    ///
    /// Compared through the minute the scheduler keys on rather than by
    /// `DateComponents ==`: Apple may normalise the components it stores (an
    /// era, a calendar, a time zone we never set), and a raw equality would
    /// then be a false negative that reads as "the scheduler accepted nothing".
    /// Both sides go through the one Linux-tested round-trip pair.
    private static func matches(
        _ scheduled: ScheduledWorkoutPlan, id: UUID, atMs: Double,
        calendar: Calendar
    ) -> Bool {
        guard scheduled.plan.id == id,
            let asked = WorkoutPlanSchedule.minuteMs(fromMs: atMs, calendar: calendar),
            let stored = WorkoutPlanSchedule.milliseconds(
                from: scheduled.date, calendar: calendar)
        else { return false }
        return asked == stored
    }

    /// The wire `ScheduledWorkoutSummary`. `nil` when the stored components
    /// cannot be turned back into an instant — see `scheduledSummaries`.
    static func summary(
        _ scheduled: ScheduledWorkoutPlan, calendar: Calendar
    ) -> [String: Any]? {
        guard
            let atMs = WorkoutPlanSchedule.milliseconds(
                from: scheduled.date, calendar: calendar)
        else { return nil }
        var summary: [String: Any] = [
            "id": scheduled.plan.id.uuidString,
            "atMs": atMs,
            "complete": scheduled.complete,
        ]
        // Omitted rather than guessed when this vocabulary excludes the case —
        // the WorkoutState.activityType rule, for the same reason.
        if let activityType = WorkoutActivityName.name(
            for: scheduled.plan.workout.activity)
        {
            summary["activityType"] = activityType
        }
        return summary
    }

    // MARK: - Spec -> WorkoutKit

    /// Builds the WorkoutKit plan, asking Apple whether each element is LEGAL
    /// before committing to it.
    ///
    /// The preflight is mandatory, not defensive padding: the activity ×
    /// location × goal × alert matrix is documented nowhere, is not stable, and
    /// has at least two confirmed-in-the-wild traps — `supportsGoal(.energy,…)`
    /// returns false for every combination on a custom workout (energy goals
    /// exist only on `SingleGoalWorkout`), and pace alerts are rejected for
    /// indoor running. Root rule 5 still applies, just to the caller's benefit:
    /// code answers, it is Apple's code, and our job is to ask BEFORE
    /// `schedule(_:at:)` swallows the answer.
    ///
    /// Checks run cheapest-first — activity, then goals, then alerts — and each
    /// refusal names the failing element by PATH, so a rejection reads
    /// `plan.blocks[2].steps[0].alert: …` rather than "bad request".
    static func plan(
        from spec: WorkoutPlanSpec
    ) -> Result<WorkoutPlan, HealthRequestError> {
        guard let activity = WorkoutActivityName.type(for: spec.activityType) else {
            return .failure(
                HealthRequestError(
                    "plan.activityType: unknown workout activityType "
                        + "'\(spec.activityType)'"))
        }
        let location = Self.location(spec.location)
        let qualifier =
            "for activityType '\(spec.activityType)' with location "
            + "'\(spec.location?.rawValue ?? "unknown")'"
        switch spec.kind {
        case .custom:
            guard CustomWorkout.supportsActivity(activity) else {
                return .failure(
                    HealthRequestError(
                        "plan.activityType: a custom workout is not supported \(qualifier)"))
            }
            var warmup: WorkoutStep?
            if let step = spec.warmup {
                switch Self.step(
                    step, "plan.warmup", activity: activity, location: location,
                    qualifier: qualifier, kind: spec.kind)
                {
                case .failure(let error): return .failure(error)
                case .success(let built): warmup = built
                }
            }
            var cooldown: WorkoutStep?
            if let step = spec.cooldown {
                switch Self.step(
                    step, "plan.cooldown", activity: activity, location: location,
                    qualifier: qualifier, kind: spec.kind)
                {
                case .failure(let error): return .failure(error)
                case .success(let built): cooldown = built
                }
            }
            var blocks: [IntervalBlock] = []
            for (blockIndex, block) in spec.blocks.enumerated() {
                var steps: [IntervalStep] = []
                for (stepIndex, interval) in block.steps.enumerated() {
                    let path = "plan.blocks[\(blockIndex)].steps[\(stepIndex)]"
                    switch Self.step(
                        interval.step, path, activity: activity, location: location,
                        qualifier: qualifier, kind: spec.kind)
                    {
                    case .failure(let error): return .failure(error)
                    case .success(let built):
                        steps.append(
                            IntervalStep(Self.purpose(interval.purpose), step: built))
                    }
                }
                blocks.append(
                    IntervalBlock(steps: steps, iterations: block.iterations))
            }
            let workout = CustomWorkout(
                activity: activity, location: location,
                displayName: spec.displayName, warmup: warmup, blocks: blocks,
                cooldown: cooldown)
            return .success(WorkoutPlan(.custom(workout), id: spec.id))
        case .singleGoal:
            guard SingleGoalWorkout.supportsActivity(activity) else {
                return .failure(
                    HealthRequestError(
                        "plan.activityType: a single-goal workout is not supported "
                            + "\(qualifier)"))
            }
            // `spec.goal` is required for this kind and validated in Support.
            let goal = Self.goal(spec.goal ?? WorkoutPlanGoalSpec(kind: .open, value: nil))
            guard
                SingleGoalWorkout.supportsGoal(
                    goal, activity: activity, location: location)
            else {
                return .failure(
                    HealthRequestError(
                        "plan.goal: \(spec.goal?.kind.rawValue ?? "open") is not "
                            + "supported \(qualifier)"))
            }
            let workout = SingleGoalWorkout(
                activity: activity, location: location, goal: goal)
            return .success(WorkoutPlan(.goal(workout), id: spec.id))
        case .pacer:
            guard PacerWorkout.supportsActivity(activity) else {
                return .failure(
                    HealthRequestError(
                        "plan.activityType: a pacer workout is not supported \(qualifier)"))
            }
            // Both validated positive-and-finite in Support.
            let workout = PacerWorkout(
                activity: activity, location: location,
                distance: Measurement(
                    value: spec.distanceMeters ?? 0, unit: UnitLength.meters),
                time: Measurement(
                    value: spec.durationSeconds ?? 0, unit: UnitDuration.seconds))
            return .success(WorkoutPlan(.pacer(workout), id: spec.id))
        }
    }

    /// One step, with its goal and alert put through Apple's legality checks.
    private static func step(
        _ spec: WorkoutPlanStepSpec, _ path: String,
        activity: HKWorkoutActivityType, location: HKWorkoutSessionLocationType,
        qualifier: String, kind: WorkoutPlanSpecKind
    ) -> Result<WorkoutStep, HealthRequestError> {
        var goal: WorkoutGoal = .open
        if let goalSpec = spec.goal {
            goal = Self.goal(goalSpec)
            guard
                CustomWorkout.supportsGoal(
                    goal, activity: activity, location: location)
            else {
                // The documented-in-the-wild trap gets named, because "energy
                // is not supported" reads as a device limitation when it is
                // actually a workout-KIND limitation.
                let hint =
                    goalSpec.kind == .energy
                    ? " — energy goals are legal only on kind:'singleGoal'" : ""
                return .failure(
                    HealthRequestError(
                        "\(path).goal: \(goalSpec.kind.rawValue) is not supported "
                            + "\(qualifier)\(hint)"))
            }
        }
        var alert: (any WorkoutAlert)?
        if let alertSpec = spec.alert {
            let built = Self.alert(alertSpec)
            guard
                CustomWorkout.supportsAlert(
                    built, activity: activity, location: location)
            else {
                return .failure(
                    HealthRequestError(
                        "\(path).alert: \(alertSpec.kind.rawValue) is not supported "
                            + "\(qualifier)"
                    ))
            }
            alert = built
        }
        return .success(WorkoutStep(goal: goal, alert: alert))
    }

    private static func purpose(
        _ purpose: WorkoutPlanStepPurpose
    ) -> IntervalStep.Purpose {
        switch purpose {
        case .work: .work
        case .recovery: .recovery
        }
    }

    /// Absent maps to WorkoutKit's own `.unknown` — not a third wire value.
    private static func location(
        _ location: WorkoutLocation?
    ) -> HKWorkoutSessionLocationType {
        switch location {
        case .indoor: .indoor
        case .outdoor: .outdoor
        case nil: .unknown
        }
    }

    /// Units come from the FIELD NAME on the wire, so they are re-applied here
    /// once and never carried as a caller-chosen string.
    private static func goal(_ spec: WorkoutPlanGoalSpec) -> WorkoutGoal {
        // `value` is validated non-nil for the three carrying kinds; `.open`
        // never reads it.
        let value = spec.value ?? 0
        switch spec.kind {
        case .open: return .open
        case .distance: return .distance(value, .meters)
        case .time: return .time(value, .seconds)
        case .energy: return .energy(value, .kilocalories)
        }
    }

    /// The nine alert shapes, built through Apple's own factory funcs. Every
    /// unit is spelled explicitly even where Apple defaults it, so a reader can
    /// see that `metersPerSecond` on the wire really is what reaches
    /// `UnitSpeed` — the pace-vs-speed confusion is the one this package's
    /// JSDoc has to keep straight.
    private static func alert(_ spec: WorkoutPlanAlertSpec) -> any WorkoutAlert {
        let low = spec.lower ?? 0
        let high = spec.upper ?? 0
        let value = spec.threshold ?? 0
        let zone = spec.zone ?? 1
        // The 10.0 speed selector. The POWER equivalent is watchOS 10.4 and is
        // deliberately not exposed — the power alerts below use the 10.0
        // `power(_:unit:)` form, which keeps this package `@available`-free.
        let metric: WorkoutAlertMetric = spec.metric == .average ? .average : .current
        switch spec.kind {
        case .heartRateRange:
            return HeartRateRangeAlert.heartRate(low...high, unit: .countPerMinute)
        case .heartRateZone:
            return HeartRateZoneAlert.heartRate(zone: zone)
        case .speedRange:
            return SpeedRangeAlert.speed(
                low...high, unit: .metersPerSecond, metric: metric)
        case .speedThreshold:
            return SpeedThresholdAlert.speed(
                value, unit: .metersPerSecond, metric: metric)
        case .cadenceRange:
            return CadenceRangeAlert.cadence(low...high, unit: .countPerMinute)
        case .cadenceThreshold:
            return CadenceThresholdAlert.cadence(value, unit: .countPerMinute)
        case .powerRange:
            return PowerRangeAlert.power(low...high, unit: .watts)
        case .powerThreshold:
            return PowerThresholdAlert.power(value, unit: .watts)
        case .powerZone:
            return PowerZoneAlert.power(zone: zone)
        }
    }

    /// A bare JSON string. The four authorization names are fixed literals
    /// with nothing to escape, which is why this is two characters rather than
    /// a JSONSerialization round trip (which rejects a top-level fragment).
    private static func jsonString(_ value: String) -> String { "\"\(value)\"" }

    /// JSON for an already-JSON-safe object/array.
    private static func json(_ value: Any) -> String {
        (try? JSONSerialization.data(withJSONObject: value))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "null"
    }
}
#endif
