// The single owner of this process's HKWorkoutSession. watchOS-only, like the
// rest of ReactWatchHost.
//
// WHY THIS EXISTS. Apple, HKWorkoutSession (Discussion): "Apple Watch runs one
// workout session at a time. If a second workout starts while your workout is
// running, your session receives an error, and your session ends." SensorBridge
// used to construct its own hidden `.other` session as a heart-rate pump. Adding
// an explicit startWorkout() next to it would create a SECOND owner of a
// single-occupancy system slot, and the failure mode is the user's heart-rate
// stream dying mid-workout. So there is exactly one construction site — this one
// — and both callers take a CLAIM on it instead:
//
//   .heartRate  the hidden pump behind js/src/sensors.ts startHeartRate.
//               Starts an `.other` session only if none exists. From JS's side
//               `startHeartRate` is completely unchanged.
//   .workout    the explicit js/src/workout.ts session, with a real
//               HKWorkoutConfiguration, pause/resume, metrics and a save.
//
// Transitions between them are the whole point:
//   UPGRADE   startWorkout while the pump is live: END the pump session, start
//             the configured one, re-attach the heart-rate reading to the new
//             builder. JS sees one uninterrupted `sensor.heartRate`
//             subscription with a one-transition gap.
//   DOWNGRADE endWorkout while startHeartRate is still subscribed: end + save
//             the explicit session, then start a fresh pump.
//   REFUSAL   startWorkout while an explicit workout is live: refuse
//             SYNCHRONOUSLY. That is the ExtendedRuntimeBridge.start() -> Bool
//             precedent verbatim, for the identical reason — it is the one
//             refusal that produces NO delegate callback, so a parked invoke
//             would otherwise hang to its 30 s watchdog.
#if os(watchOS)
import CoreLocation
import Foundation
import HealthKit
import ReactWatchSupport

final class WorkoutSessionOwner: NSObject {
    /// Who the live session belongs to. `.workout` outranks `.heartRate`: an
    /// explicit workout PINS the session (that is what makes it legal to keep
    /// running in the background), so the background pause can only ever end a
    /// pump-only session.
    enum Claim {
        case heartRate
        case workout
    }

    /// One heart-rate reading (bpm) — wired straight to SensorBridge's existing
    /// `sensor.heartRate` push, so the JS-visible stream is byte-identical to
    /// what the pump produced before this file existed.
    var onHeartRate: ((Double) -> Void)?
    /// (state, reason, epoch) for the `workout.state` push AND for settling the
    /// parked `startWorkout` invokes, exactly like ExtendedRuntimeBridge.onState.
    var onState: ((_ state: String, _ reason: String?, _ epoch: Int) -> Void)?
    /// Coalesced `workout.metrics` payload.
    var onMetrics: (([String: Any]) -> Void)?

    private let healthStore = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private var routeBuilder: HKWorkoutRouteBuilder?
    private var claim: Claim?
    /// The configuration the live `.workout` session was started with, kept for
    /// the state snapshot (HKWorkoutSession exposes it, but not the wire names).
    private var activePlan: WorkoutStartPlan?

    /// Monotonic id of the session made by the last accepted start; 0 = none.
    /// A delegate callback carries the epoch of the session it belongs to, so a
    /// stale session's terminal callback can never settle a start parked for
    /// the live one. Bumped when the start is ACCEPTED (not when the session
    /// object appears), because the HealthKit authorization round trip sits in
    /// between and the caller has to be parked across it.
    private(set) var epoch = 0

    /// A `.workout` start accepted and waiting on the authorization sheet. Also
    /// the "a start is already in flight" guard: without it a second
    /// startWorkout inside the auth window would bump the epoch and orphan the
    /// first parked invoke.
    private var pendingStart: WorkoutStartPlan?

    /// Desired-state latch for the heart-rate pump, owned here rather than in
    /// SensorBridge because the DOWNGRADE (endWorkout while startHeartRate is
    /// still subscribed) has to know whether to bring the pump back.
    private var wantHeartRate = false

    /// Metrics coalescing: `didCollectDataOf` fires per collected sample.
    private var lastMetricsAt: Date = .distantPast

    /// The last workout that ended, reported by `getWorkoutState()` until
    /// another one ends. This is how a workout ended by a runtime reload
    /// reaches the runtime that did NOT start it — pushing an event into a
    /// dying context reaches nobody, so the snapshot is parked and the fresh
    /// runtime reads it.
    private var lastEnded: [String: Any] = [:]

    // MARK: - Heart-rate claim (the hidden pump)

    /// Whether an explicit workout is live (or starting) — the refusal test and
    /// the "an explicit claim pins the session" test.
    var isWorkoutActive: Bool {
        pendingStart != nil || (claim == .workout && session != nil)
    }

    /// SensorBridge asking for the pump. A no-op while an explicit workout is
    /// live: that session already collects heart rate, so JS keeps receiving
    /// `sensor.heartRate` through the same builder delegate.
    func claimHeartRate() {
        wantHeartRate = true
        guard !isWorkoutActive else { return }
        guard session == nil else { return }
        beginPumpSession()
    }

    /// Release the pump claim. Returns whether a session was actually ended, so
    /// SensorBridge's background pause knows whether there is anything to
    /// restore on the next foreground (a pump ended by an explicit workout's
    /// arrival must not be "restored" over it).
    @discardableResult func releaseHeartRate() -> Bool {
        wantHeartRate = false
        guard claim == .heartRate, session != nil else { return false }
        endSession(reason: .requested, discard: true, completion: nil)
        return true
    }

    /// The background backstop (P0-3), unified: end the session only when the
    /// SOLE claim is the pump. An explicit `.workout` claim pins it — that is
    /// the entire point of a workout, watchOS shows the running-workout chip on
    /// the face, and the `workout-processing` background mode is what makes it
    /// legal. One rule, rather than a second flag parallel to the first.
    @discardableResult func pauseForBackground(keepAlive: Bool) -> Bool {
        guard !isWorkoutActive, !keepAlive else { return false }
        guard claim == .heartRate, session != nil else { return false }
        // Keeps `wantHeartRate`: the caller's restart latch is what decides
        // whether to come back, and a session begun pre-authorization can
        // occupy the slot dead.
        let want = wantHeartRate
        endSession(reason: .requested, discard: true, completion: nil)
        wantHeartRate = want
        return true
    }

    /// scenePhase -> .active: bring the pump back if nothing else owns the slot.
    func resumeHeartRateIfWanted() {
        guard wantHeartRate, !isWorkoutActive, session == nil else { return }
        beginPumpSession()
    }

    private func beginPumpSession() {
        let configuration = HKWorkoutConfiguration()
        configuration.activityType = .other
        epoch += 1
        start(configuration: configuration, claim: .heartRate, plan: nil)
    }

    // MARK: - Explicit workout (js/src/workout.ts)

    /// Accepts a `startWorkout`, or returns the refusal message. Non-nil means
    /// the caller must reject the invoke NOW: these are the outcomes that
    /// produce no delegate callback at all.
    func startWorkout(_ plan: WorkoutStartPlan) -> String? {
        guard HKHealthStore.isHealthDataAvailable() else {
            return "HealthKit is not available on this device"
        }
        guard let activity = WorkoutActivityName.type(for: plan.activityType) else {
            return "unknown workout activityType '\(plan.activityType)'"
        }
        guard !isWorkoutActive else {
            return "a workout is already running — end it before starting another"
        }
        let configuration = HKWorkoutConfiguration()
        configuration.activityType = activity
        if let location = plan.location {
            configuration.locationType =
                location == .indoor ? .indoor : .outdoor
        }
        epoch += 1
        pendingStart = plan
        // Share authorization is requested as part of STARTING, which is what a
        // real workout app does — asking separately would make a second method
        // whose only job is a sheet. The route series type is only asked for
        // when a route is actually being recorded.
        var share: Set<HKSampleType> = [HKObjectType.workoutType()]
        if plan.collectRoute { share.insert(HKSeriesType.workoutRoute()) }
        let read: Set<HKObjectType> = [HKQuantityType(.heartRate)]
        let attempt = epoch
        nonisolated(unsafe) let this = self
        healthStore.requestAuthorization(toShare: share, read: read) { _, _ in
            // `ok` is deliberately not gated on: it reports that the SHEET
            // completed, not that anything was granted, and a session started
            // without the save permission still streams metrics — the save is
            // what fails, loudly, at endWorkout.
            DispatchQueue.main.async {
                // Dropped if the start was superseded or torn down inside the
                // authorization window (the SensorBridge auth-window guard,
                // generalized): starting now would occupy the single system
                // slot for a runtime that no longer wants it.
                guard this.pendingStart != nil, this.epoch == attempt else { return }
                this.pendingStart = nil
                this.start(configuration: configuration, claim: .workout, plan: plan)
            }
        }
        return nil
    }

    func pauseWorkout() -> Bool {
        guard claim == .workout, let session, session.state == .running else {
            return false
        }
        session.pause()
        return true
    }

    func resumeWorkout() -> Bool {
        guard claim == .workout, let session, session.state == .paused else {
            return false
        }
        session.resume()
        return true
    }

    /// Ends the explicit workout, saving unless `discard`. `completion` gets the
    /// state snapshot the invoke resolves with. Returns false when there is no
    /// explicit workout to end — again a refusal with no callback, so the
    /// caller rejects synchronously rather than parking forever.
    func endWorkout(
        discard: Bool, completion: @escaping ([String: Any]) -> Void
    ) -> Bool {
        guard claim == .workout, session != nil else { return false }
        endSession(
            reason: discard ? .discarded : .requested, discard: discard,
            completion: completion)
        return true
    }

    /// ARCH-08 deterministic teardown. A dev reload or an OTA apply ends the
    /// explicit session, saves it, and parks the snapshot for the runtime that
    /// comes next — it never inherits a live workout it did not start. The
    /// alternative (keep it alive across the reload, the BLE precedent) was
    /// rejected for v1 precisely because an OTA bundle would inherit someone
    /// else's workout; surviving + re-attaching via
    /// `recoverActiveWorkoutSession` is recorded as the follow-up.
    ///
    /// The delegate is detached first, so nothing from the outgoing session can
    /// push a stale `workout.state` into the freshly booted runtime.
    func tearDownForReload() {
        wantHeartRate = false
        pendingStart = nil
        guard session != nil else { return }
        let wasWorkout = claim == .workout
        detachDelegates()
        endSession(
            reason: wasWorkout ? .runtimeReload : .requested,
            discard: !wasWorkout, completion: nil)
    }

    deinit {
        // Releasing the single system slot is the safety property P0-3 bought
        // and it must not regress: a discarded owner must not leak the
        // daemon-owned session. `finishWorkout` is submitted fire-and-forget —
        // its completion may never be delivered on a deallocating object, so
        // the save is SUBMITTED, not confirmed. The supported save path is
        // endWorkout().
        session?.delegate = nil
        builder?.delegate = nil
        session?.end()
        builder?.endCollection(withEnd: Date()) { [builder] _, _ in
            builder?.finishWorkout { _, _ in }
        }
    }

    // MARK: - Session lifecycle

    private func start(
        configuration: HKWorkoutConfiguration, claim: Claim,
        plan: WorkoutStartPlan?
    ) {
        // Idempotent against a second auth completion (start -> reload ->
        // start): a second session here would leak the first AND kill it.
        guard session == nil else { return }
        do {
            let session = try HKWorkoutSession(
                healthStore: healthStore, configuration: configuration)
            let builder = session.associatedWorkoutBuilder()
            builder.dataSource = HKLiveWorkoutDataSource(
                healthStore: healthStore, workoutConfiguration: configuration)
            session.delegate = self
            builder.delegate = self
            self.session = session
            self.builder = builder
            self.claim = claim
            activePlan = plan
            lastMetricsAt = .distantPast
            if plan?.collectRoute == true {
                routeBuilder =
                    builder.seriesBuilder(for: HKSeriesType.workoutRoute())
                    as? HKWorkoutRouteBuilder
            }
            session.startActivity(with: Date())
            builder.beginCollection(withStart: Date()) { _, _ in }
        } catch {
            activePlan = nil
            self.claim = nil
            // A start that throws produces no delegate callback, so emit the
            // terminal state ourselves or the parked invoke hangs.
            emitState("ended", error.localizedDescription, epoch)
        }
    }

    /// The one teardown path. `discard` skips the save (and the route finish);
    /// `completion` receives the state snapshot once the save settles.
    private func endSession(
        reason: WorkoutEndReason, discard: Bool,
        completion: (([String: Any]) -> Void)?
    ) {
        guard let session, let builder else {
            completion?(stateSnapshot())
            return
        }
        let endedAt = Date()
        let duration = builder.elapsedTime * 1000
        let energy = quantity(.activeEnergyBurned, from: builder, unit: .kilocalorie())
        let distance = distanceMeters(from: builder)
        let route = routeBuilder
        self.session = nil
        self.builder = nil
        routeBuilder = nil
        claim = nil
        activePlan = nil
        session.end()
        nonisolated(unsafe) let this = self
        nonisolated(unsafe) let settle = completion
        builder.endCollection(withEnd: endedAt) { _, _ in
            guard !discard else {
                DispatchQueue.main.async {
                    this.recordEnded(
                        reason: reason, durationMs: duration, workoutId: nil,
                        energyKcal: energy, distanceMeters: distance)
                    settle?(this.stateSnapshot())
                    this.restorePumpIfWanted()
                }
                return
            }
            builder.finishWorkout { workout, error in
                // The route is finished AFTER the workout is saved, per
                // HKWorkoutRouteBuilder's documented order.
                route?.finishRoute(with: workout, metadata: nil) { _, _ in }
                DispatchQueue.main.async {
                    this.recordEnded(
                        reason: error == nil ? reason : .failed,
                        durationMs: duration,
                        workoutId: workout?.uuid.uuidString,
                        energyKcal: energy, distanceMeters: distance)
                    settle?(this.stateSnapshot())
                    this.restorePumpIfWanted()
                }
            }
        }
    }

    /// The DOWNGRADE: `startHeartRate` is still subscribed, so the pump comes
    /// back on a fresh session (and a fresh epoch) once the explicit one is
    /// fully saved.
    private func restorePumpIfWanted() {
        guard wantHeartRate, session == nil, pendingStart == nil else { return }
        beginPumpSession()
    }

    private func recordEnded(
        reason: WorkoutEndReason, durationMs: Double, workoutId: String?,
        energyKcal: Double?, distanceMeters: Double?
    ) {
        var ended: [String: Any] = [
            "endedReason": reason.rawValue,
            "endedDurationMs": durationMs,
        ]
        if let workoutId { ended["endedWorkoutId"] = workoutId }
        if let energyKcal { ended["endedTotalEnergyKcal"] = energyKcal }
        if let distanceMeters { ended["endedDistanceMeters"] = distanceMeters }
        lastEnded = ended
    }

    private func detachDelegates() {
        session?.delegate = nil
        builder?.delegate = nil
    }

    // MARK: - Route

    /// One CLLocation batch from the stream SensorBridge already owns. A second
    /// CLLocationManager would double the GPS duty cycle for the same fixes.
    func insertRoute(_ locations: [CLLocation]) {
        guard let routeBuilder, !locations.isEmpty else { return }
        routeBuilder.insertRouteData(locations) { _, _ in }
    }

    var isCollectingRoute: Bool { routeBuilder != nil }

    // MARK: - State snapshot (the WorkoutState response shape)

    /// The `WorkoutState` both `getWorkoutState` and `endWorkout` resolve with.
    /// `lastEnded` is NOT cleared after reporting: "the last workout that ended"
    /// is a stable fact a screen can render at any time, and clearing it would
    /// make the reload-recovery report a one-shot that a re-render loses.
    func stateSnapshot() -> [String: Any] {
        var snapshot: [String: Any] = [
            "state": currentStateName().rawValue,
            "elapsedMs": (builder?.elapsedTime ?? 0) * 1000,
        ]
        if let plan = activePlan {
            snapshot["activityType"] = plan.activityType
            if let location = plan.location {
                snapshot["location"] = location.rawValue
            }
        }
        for (key, value) in lastEnded { snapshot[key] = value }
        return snapshot
    }

    private func currentStateName() -> WorkoutStateName {
        guard claim == .workout, let session else {
            return lastEnded.isEmpty ? .notStarted : .ended
        }
        return Self.stateName(session.state)
    }

    /// `prepared` and `stopped` are folded rather than given wire names of their
    /// own: this owner never calls `prepare()` or `stopActivity(with:)`, so
    /// nothing can produce them, and inventing vocabulary nothing emits is how a
    /// union stops describing reality.
    private static func stateName(_ state: HKWorkoutSessionState) -> WorkoutStateName {
        switch state {
        case .running: .running
        case .paused: .paused
        case .ended, .stopped: .ended
        default: .notStarted
        }
    }

    private func quantity(
        _ identifier: HKQuantityTypeIdentifier, from builder: HKLiveWorkoutBuilder,
        unit: HKUnit
    ) -> Double? {
        builder.statistics(for: HKQuantityType(identifier))?
            .sumQuantity()?.doubleValue(for: unit)
    }

    /// HealthKit records distance under a type that depends on the activity, so
    /// asking for `distanceWalkingRunning` during a ride reports nothing.
    private func distanceMeters(from builder: HKLiveWorkoutBuilder) -> Double? {
        quantity(Self.distanceIdentifier(for: activePlan), from: builder, unit: .meter())
    }

    private static func distanceIdentifier(
        for plan: WorkoutStartPlan?
    ) -> HKQuantityTypeIdentifier {
        switch plan?.activityType {
        case "cycling", "handCycling": .distanceCycling
        case "swimming": .distanceSwimming
        default: .distanceWalkingRunning
        }
    }

    /// onState calls into the @MainActor model; hop to main, matching the
    /// nonisolated(unsafe) convention SensorBridge and ExtendedRuntimeBridge use.
    private func emitState(_ state: String, _ reason: String?, _ epoch: Int) {
        nonisolated(unsafe) let handler = onState
        DispatchQueue.main.async { handler?(state, reason, epoch) }
    }

    /// The epoch a delegate callback belongs to. A session that is no longer the
    /// current one reports 0, which can never match a parked start.
    private func epoch(of session: HKWorkoutSession) -> Int {
        session === self.session ? epoch : 0
    }
}

extension WorkoutSessionOwner: HKWorkoutSessionDelegate {
    func workoutSession(
        _ session: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState,
        from _: HKWorkoutSessionState, date _: Date
    ) {
        // Only the EXPLICIT session's transitions are JS-visible: the pump is an
        // implementation detail of startHeartRate and always has been, so
        // publishing its lifecycle would invent events nobody subscribed to.
        // The epoch still goes out for the parked-start settle.
        let epoch = self.epoch(of: session)
        nonisolated(unsafe) let this = self
        DispatchQueue.main.async {
            guard this.claim == .workout || toState == .ended else { return }
            this.emitState(Self.stateName(toState).rawValue, nil, epoch)
        }
    }

    func workoutSession(
        _ session: HKWorkoutSession, didFailWithError error: Error
    ) {
        let epoch = self.epoch(of: session)
        nonisolated(unsafe) let this = self
        DispatchQueue.main.async {
            // A failure IS the terminal state for a parked start, and the
            // session is gone either way — Apple ends it on a second workout
            // starting elsewhere, which is exactly the case this reports.
            if session === this.session {
                this.session = nil
                this.builder = nil
                this.routeBuilder = nil
                this.claim = nil
                this.activePlan = nil
            }
            this.emitState("ended", error.localizedDescription, epoch)
        }
    }
}

extension WorkoutSessionOwner: HKLiveWorkoutBuilderDelegate {
    func workoutBuilder(
        _ builder: HKLiveWorkoutBuilder,
        didCollectDataOf collectedTypes: Set<HKSampleType>
    ) {
        let heartRate =
            collectedTypes.contains(HKQuantityType(.heartRate))
            ? builder.statistics(for: HKQuantityType(.heartRate))?
                .mostRecentQuantity()?
                .doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
            : nil
        // Builder callbacks arrive off the main queue; hop without sending
        // `self` (Swift 6 strict concurrency), the idiom this package already
        // uses for the off-main HealthKit reading callback.
        nonisolated(unsafe) let this = self
        DispatchQueue.main.async {
            // Gated on the pump's desired-state latch, because `sensor.heartRate`
            // is `startHeartRate`'s stream and an EXPLICIT workout collects heart
            // rate whether or not anyone subscribed to it. Ungated, a workout
            // started without startHeartRate pushed a listener-less event per
            // collected sample for the whole session — the exact per-sample
            // bridge cost `emitMetricsIfDue` coalescing exists to avoid. The
            // latch is already the one that decides whether the pump comes back
            // (restorePumpIfWanted), so this reuses it rather than adding a flag.
            if this.wantHeartRate, let heartRate { this.onHeartRate?(heartRate) }
            this.emitMetricsIfDue()
        }
    }

    func workoutBuilderDidCollectEvent(_: HKLiveWorkoutBuilder) {}

    /// `workout.metrics` is COALESCED at the plan's interval: the delegate fires
    /// per collected sample, and an uncoalesced push would cross the bridge and
    /// commit a render at the sensor's rate for the whole workout.
    private func emitMetricsIfDue() {
        guard claim == .workout, let builder, let plan = activePlan else { return }
        let now = Date()
        guard now.timeIntervalSince(lastMetricsAt) * 1000 >= plan.metricsIntervalMs
        else { return }
        lastMetricsAt = now
        var payload: [String: Any] = ["elapsedMs": builder.elapsedTime * 1000]
        if let bpm = builder.statistics(for: HKQuantityType(.heartRate))?
            .mostRecentQuantity()?
            .doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
        {
            payload["heartRateBpm"] = bpm
        }
        if let energy = quantity(
            .activeEnergyBurned, from: builder, unit: .kilocalorie())
        {
            payload["activeEnergyKcal"] = energy
        }
        if let distance = distanceMeters(from: builder) {
            payload["distanceMeters"] = distance
        }
        onMetrics?(payload)
    }
}
#endif
