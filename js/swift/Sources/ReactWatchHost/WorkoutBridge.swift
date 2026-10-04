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
//             subscription with a one-transition gap. It happens in the
//             authorization completion, which is the only place that can reach
//             `start()` with a session already live.
//   DOWNGRADE endWorkout while startHeartRate is still subscribed: end + save
//             the explicit session, then start a fresh pump — unless the app is
//             backgrounded without `keepAliveInBackground`, in which case the
//             restore is parked for the next foreground rather than reviving
//             the drain the background backstop exists to remove.
//   CANCEL    endWorkout while a start is still inside the authorization
//             window: there is no session yet, but that pending start IS the
//             workout being ended, so it is dropped and its parked invoke
//             settled. Refusing it would let the workout start anyway after
//             the caller was told nothing was running.
//   REFUSAL   startWorkout while an explicit workout is live: refuse
//             SYNCHRONOUSLY. That is the ExtendedRuntimeBridge.start() -> Bool
//             precedent verbatim, for the identical reason — it is the one
//             refusal that produces NO delegate callback, so a parked invoke
//             would otherwise hang to its 30 s watchdog.
//   RECOVERY  a session that outlived the process that started it, because that
//             process CRASHED mid-workout. Adopted once per launch, before any
//             claim is taken. Deliberately NOT the reload path — a runtime
//             reload still ends its workout deterministically; see
//             recoverOrphanedSession().
//
// The pump is INVISIBLE to the workout API in both directions: it publishes no
// `workout.state` and it never writes the `lastEnded` snapshot. Only the
// EXPLICIT claim is a "workout" as far as js/src/workout.ts is concerned, and
// what enforces that at the delegate is SESSION IDENTITY (`publishedSession`) —
// not a `claim` read, which is nil by the time a terminal callback lands.
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

    /// The one session whose transitions JS is still owed — i.e. the EXPLICIT
    /// one. This is identity, not state, and that distinction is the whole
    /// point: `claim` describes the session that is live NOW and is cleared
    /// synchronously at every teardown, so by the time a terminal delegate
    /// callback lands it is nil for the explicit session too. Reading `claim`
    /// there could therefore never separate "the workout JS is watching ended"
    /// from "the hidden pump ended", which is why an `|| toState == .ended`
    /// escape hatch used to stand in for it — and why a pump killed from
    /// OUTSIDE (Apple ends ours when a second workout starts elsewhere) slipped
    /// through: `didFailWithError`'s trailing `didChangeTo(.ended)` passed that
    /// disjunct and published a `workout.state: "ended"` at an app that never
    /// started a workout. A session this owner never published cannot publish
    /// its death, whoever killed it.
    ///
    /// Weak, like `HKWorkoutSession.delegate` itself: this names a session, it
    /// does not keep one alive.
    private weak var publishedSession: HKWorkoutSession?

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

    /// scenePhase mirror for the pump, and the half `pauseForBackground` can
    /// NOT cover: that one only ends a session that exists at the moment of
    /// backgrounding, while the DOWNGRADE runs later, when the save settles. A
    /// workout ended while the app is away would otherwise start a fresh
    /// `.other` session that keeps the app alive sampling heart rate — the
    /// exact drain `keepAliveInBackground: false` asked to avoid, arrived at
    /// through the one door the backstop doesn't watch.
    private var pumpBlockedByBackground = false

    /// A `recoverActiveWorkoutSession` round trip is in flight — see
    /// `recoverOrphanedSession()`. The pump is deferred for its duration:
    /// starting one would take the single system slot and, per Apple's own
    /// rule, END the very session being recovered.
    private var recovering = false

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
        // Recorded BEFORE the guards, because the guards are about what is live
        // NOW and the flag is about what may be restored LATER: an explicit
        // workout pins the session at this moment, but it can end while the app
        // is still away, and the pump the DOWNGRADE would bring back is the one
        // this flag speaks for.
        pumpBlockedByBackground = !keepAlive
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

    /// scenePhase -> .active: lift the background block and bring the pump back
    /// if nothing else owns the slot.
    ///
    /// Called unconditionally by `SensorBridge.resumeFromForeground`, because
    /// it is the only way back for the two restores that bridge's own
    /// `heartRatePendingRestart` latch cannot see:
    ///  - a DOWNGRADE parked while the app was away (the pause ended nothing,
    ///    because an explicit workout pinned the session, so the latch is
    ///    false — but the workout then ended in the background);
    ///  - a session killed from OUTSIDE. Apple ends ours when a second workout
    ///    starts elsewhere, and suspends a backgrounded app that never declared
    ///    `workout-processing`; `didFailWithError` clears the session without
    ///    setting any latch, so the pump would otherwise stay dead forever with
    ///    `wantHeartRate` still true. Foreground is the one moment when
    ///    re-taking the single system slot is both legal and wanted — restarting
    ///    inside the failure would either fight the app that just took the slot
    ///    or loop against the suspension that caused it — and it is where the
    ///    app lands in practice, since the app that took the slot had to be
    ///    frontmost.
    func resumeHeartRateIfWanted() {
        pumpBlockedByBackground = false
        guard wantHeartRate, !isWorkoutActive, session == nil else { return }
        beginPumpSession()
    }

    private func beginPumpSession() {
        // The crash-recovery window, guarded at the ONE choke point every pump
        // start goes through (claim / resume / restore all land here). A pump
        // started inside it would occupy the single slot and, per Apple, end
        // the session `recoverActiveWorkoutSession` is in the middle of handing
        // back — losing the user's real workout to a heart-rate stream. The
        // completion calls `restorePumpIfWanted()` on every path, so the pump is
        // DEFERRED by one healthd round trip, never dropped.
        guard !recovering else { return }
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
                // Dropped if the start was superseded, CANCELLED by endWorkout,
                // or torn down inside the authorization window (the
                // SensorBridge auth-window guard, generalized): starting now
                // would occupy the single system slot for a runtime that no
                // longer wants it — or that just asked for it to stop.
                guard this.pendingStart != nil, this.epoch == attempt else { return }
                this.pendingStart = nil
                // The UPGRADE, and it has to happen HERE: this is the only call
                // site that can reach `start()` with a session already live, and
                // `start()` is idempotent against one (its `guard session ==
                // nil` is the real double-auth-completion guard). Without ending
                // the pump first the configured session is never built, no
                // delegate callback ever fires, and the parked invoke hangs to
                // its 30 s watchdog. A live session here can only BE the pump:
                // `startWorkout` refused if a workout was already active, and
                // `claimHeartRate` no-ops for the whole window. The pump goes
                // first rather than second, per Apple — a second workout started
                // while one runs ends the first, which would kill the workout we
                // are trying to start. No restore race: `endSession` nils
                // `session`/`claim` synchronously and queues its
                // `restorePumpIfWanted` behind us on main, by which time the
                // configured session owns the slot, so it stands down.
                // `wantHeartRate` is untouched, so the DOWNGRADE still works,
                // and heart rate needs no explicit re-attach — the new builder's
                // `didCollectDataOf` feeds the same `sensor.heartRate` push.
                if this.session != nil {
                    this.endSession(
                        reason: .requested, discard: true, completion: nil)
                }
                // The configuration is BUILT here, not before the authorization
                // call, because `HKWorkoutConfiguration` is not Sendable and
                // this closure is where it is consumed: constructed outside, it
                // would be captured first by HealthKit's @Sendable completion
                // (after which region isolation treats it as task-isolated) and
                // then again by this main-actor closure — a second send of a
                // value the compiler can no longer prove unshared, which Swift 6
                // rejects ("sending 'configuration' risks causing data races").
                // Built from the Sendable inputs (`activity`, `plan`), it is
                // born in this region and never crosses an isolation boundary.
                let configuration = HKWorkoutConfiguration()
                configuration.activityType = activity
                if let location = plan.location {
                    configuration.locationType =
                        location == .indoor ? .indoor : .outdoor
                }
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
    /// state snapshot the invoke resolves with. Also CANCELS a start that has
    /// not finished starting — see the branch below. Returns false only when
    /// there is genuinely nothing to end, neither pending nor live — again a
    /// refusal with no callback, so the caller rejects synchronously rather
    /// than parking forever.
    func endWorkout(
        discard: Bool, completion: @escaping ([String: Any]) -> Void
    ) -> Bool {
        // A start still inside the HealthKit authorization window IS the workout
        // this call is ending — there is just no session yet. Clearing the plan
        // makes the auth completion's `pendingStart != nil` guard fail, so no
        // session is ever created. Without this the cancel is refused ("no
        // workout is running") while `isWorkoutActive` is simultaneously true,
        // and the workout starts anyway once the round trip completes — the
        // caller told nothing is running while a session (and, with
        // `collectRoute`, full-power GPS) runs unattended on the one system
        // slot. The window is not just the first-ever sheet: Apple calls the
        // completion without prompting once the types are decided, and a React
        // effect cleanup lands in it with no tap at all.
        if pendingStart != nil {
            pendingStart = nil
            // Required, not decoration: nothing else will ever produce a
            // callback for a session that was never created, so the parked
            // `startWorkout` would hang to its 30 s watchdog. This is the same
            // escape hatch `start()`'s catch uses, and the host turns it into
            // the "ended before it started" rejection. No `recordEnded`:
            // nothing ran, so `getWorkoutState()` stays `notStarted` rather
            // than overwriting a genuinely completed earlier workout with a
            // zero-duration, id-less entry. `discard` is deliberately unused —
            // nothing was collected, so there is nothing to save or throw away.
            emitState(
                "ended", "endWorkout() was called while it was still starting",
                epoch)
            completion(stateSnapshot())
            // `claimHeartRate()` no-ops while a start is pending, so a
            // subscriber that arrived inside the window has no session; now
            // that the start is gone, the pump is owed one.
            restorePumpIfWanted()
            return true
        }
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

    // MARK: - Crash recovery (a session that outlived its process)

    /// Adopts a workout left running by a launch that CRASHED mid-session.
    ///
    /// Apple, `recoverActiveWorkoutSession(completion:)` (watchOS 5.0, below the
    /// v10 floor): *"If your app crashes during an active workout session, the
    /// system calls your extension delegate's … method the next time your app
    /// launches. To recover the workout session, call … As soon as you receive
    /// the session object, you must access its builder and set up your data
    /// source and delegates again."*
    ///
    /// THIS IS NOT THE RELOAD PATH, and conflating the two would undo the
    /// ARCH-08 decision `tearDownForReload` implements:
    ///
    ///  - a JS runtime **reload** (dev hot-reload, OTA apply) still ends the
    ///    workout DETERMINISTICALLY — end, save, park the snapshot for the
    ///    fresh runtime's first `getWorkoutState()`. The process is alive, the
    ///    workout belongs to the bundle that started it, and an incoming bundle
    ///    must not inherit one it never started. Unchanged.
    ///  - this is process **DEATH**. Nothing ended that session and nothing
    ///    saved it; it is still running on the user's wrist and still holding
    ///    the one slot watchOS allows. There is no runtime it could be handed
    ///    back to — the one that started it no longer exists — so the choice is
    ///    adopt it or strand it, and stranding it burns the slot for the whole
    ///    next launch and loses the workout.
    ///
    /// Called ONCE per process, from `ReactWatchModel.start()`. Never from
    /// `boot()`, which runs again on every reload: a second recovery per launch
    /// is the shape that would blur the distinction above. Whether the
    /// completion lands before or after a reload is deliberately NOT guarded on
    /// the generation — a recovered session was started by neither runtime, so
    /// "the runtime that started it" has no meaning here, and the live one is
    /// the only one that can report it. The next reload ends and saves it like
    /// any other.
    func recoverOrphanedSession() {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        recovering = true
        nonisolated(unsafe) let this = self
        healthStore.recoverActiveWorkoutSession { session, _ in
            // The error arm carries nothing actionable — "no session to
            // recover" is the overwhelmingly common answer and is reported the
            // same way — and there is no invoke parked on this, so there is
            // nothing to reject. What must happen on EVERY path is lifting the
            // pump deferral below.
            DispatchQueue.main.async {
                this.recovering = false
                if let session { this.adopt(session) }
                // Owed on every path: `beginPumpSession` refused for the whole
                // window. A no-op when the adopted workout now owns the slot
                // (its own `session == nil` guard), the pump otherwise.
                this.restorePumpIfWanted()
            }
        }
    }

    /// Re-attaches a recovered session: builder, data source, delegates, claim.
    private func adopt(_ session: HKWorkoutSession) {
        // The slot is single-occupancy, so a session we ALREADY own outranks
        // the recovered one. `beginPumpSession` defers for the window, but a
        // `startWorkout` from the freshly booted bundle can still land inside
        // it, and by Apple's rule that newer start has already ended this one.
        // Ending it explicitly releases the daemon's handle instead of leaving
        // a zombie no code path can reach.
        guard self.session == nil, pendingStart == nil else {
            session.end()
            return
        }
        let configuration = session.workoutConfiguration
        let builder = session.associatedWorkoutBuilder()
        builder.dataSource = HKLiveWorkoutDataSource(
            healthStore: healthStore, workoutConfiguration: configuration)
        session.delegate = self
        builder.delegate = self
        self.session = session
        self.builder = builder
        claim = .workout
        publishedSession = session
        // `nil` only if a PREVIOUS binary's vocabulary had a name this one
        // dropped (our own `startWorkout` can't start an activity outside the
        // 81). The snapshot then omits `activityType` rather than naming the
        // wrong workout, and the metrics push — which needs the plan's interval
        // — stays quiet; the session itself is still adopted, because holding
        // the slot open matters more than the label.
        activePlan = WorkoutActivityName.name(for: configuration.activityType)
            .map {
                WorkoutStartPlan.recovered(
                    activityType: $0,
                    location: configuration.locationType == .indoor
                        ? .indoor
                        : configuration.locationType == .outdoor ? .outdoor : nil)
            }
        lastMetricsAt = .distantPast
        // No `beginCollection`: the crashed launch already began it and the
        // builder has been collecting ever since — that is the data this
        // recovers. And no epoch settle to worry about: the bump gives the
        // adopted session an identity no parked start can match, because no
        // start was ever parked for it.
        epoch += 1
        emitState(
            Self.stateName(session.state).rawValue,
            "recovered a workout left running by a previous launch", epoch)
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
            // The identity half of "the pump is invisible": only an EXPLICIT
            // session is ever named here, so only its transitions can be
            // published — including the ones that arrive after `claim` has been
            // cleared, and the ones nobody on this side asked for (an outside
            // kill). Set at the construction site, because that is the only
            // place the claim and the session object are known together.
            if claim == .workout { publishedSession = session }
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
            // terminal state ourselves or the parked invoke hangs. Only for the
            // EXPLICIT claim: no invoke is ever parked on a pump start, so
            // emitting here for one would publish `workout.state: "ended"` to an
            // app that started no workout — the same leak the delegate's
            // identity check closes, one door over.
            if claim == .workout {
                emitState("ended", error.localizedDescription, epoch)
            }
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
        // Whose teardown this is has to be captured HERE, because `claim` is
        // nil'd two lines down and the delegate callback that follows cannot
        // tell the two apart on its own — `claim` is already nil by then for
        // the EXPLICIT session too, which is why the `.ended` escape hatch at
        // the delegate exists and why the fix has to live at this site.
        let wasPump = claim == .heartRate
        self.session = nil
        self.builder = nil
        routeBuilder = nil
        // The pump is an implementation detail of `startHeartRate` and JS never
        // saw it start, so its teardown must publish nothing. `publishedSession`
        // is what GUARANTEES that at the delegate (a session never named there
        // can never publish, whoever ends it); this detach is the cheap early
        // out that keeps a dying pump from scheduling main-queue work per
        // transition at all — the `tearDownForReload` idiom, `delegate` being
        // weak and already nil'd in `deinit` and `detachDelegates`. It covers
        // only the teardowns WE run, which is why it is not the rule: an
        // outside kill hands us a session we were never given the chance to
        // detach. Only the session delegate — `builder.delegate` stays attached
        // so the pump's last heart-rate readings still reach `sensor.heartRate`.
        if wasPump { session.delegate = nil }
        claim = nil
        activePlan = nil
        session.end()
        nonisolated(unsafe) let this = self
        nonisolated(unsafe) let settle = completion
        builder.endCollection(withEnd: endedAt) { _, _ in
            guard !discard else {
                DispatchQueue.main.async {
                    // The other half of the same rule: `lastEnded` is the
                    // `getWorkoutState()` snapshot, so recording a pump end
                    // there reports `state: "ended"`, `endedReason: "requested"`
                    // and the pump's duration for a workout that never ran —
                    // permanently, since `lastEnded` is deliberately sticky —
                    // and, after an UPGRADE, alongside a live `state: "running"`.
                    // The save branch below needs no such guard: it is reached
                    // only with `discard == false`, which only `endWorkout` (a
                    // `.workout` claim) can ask for.
                    if !wasPump {
                        this.recordEnded(
                            reason: reason, durationMs: duration, workoutId: nil,
                            energyKcal: energy, distanceMeters: distance)
                    }
                    settle?(this.stateSnapshot())
                    this.restorePumpIfWanted()
                }
                return
            }
            builder.finishWorkout { workout, error in
                // The route is finished AFTER the workout is saved, per
                // HKWorkoutRouteBuilder's documented order. A failed save has
                // no workout to attach the route to, so the route is dropped
                // with it (the `.failed` record below already reports why).
                if let workout {
                    route?.finishRoute(with: workout, metadata: nil) { _, _ in }
                }
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
        // Backgrounded without `keepAliveInBackground`: park the restore for the
        // next foreground rather than starting a fresh `.other` session that
        // re-grants background execution and re-arms heart-rate sampling for an
        // app the user has already left. `pauseForBackground` cannot cover this
        // — it only ends what is live at the moment of backgrounding, and the
        // workout whose end triggers this restore was still running then.
        guard !pumpBlockedByBackground else { return }
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
        // A detached session can no longer publish anything; leaving it named
        // would make the identity invariant read as though it still could.
        publishedSession = nil
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
    /// asking for `distanceWalkingRunning` during a ride reports nothing. The
    /// table itself lives in `WorkoutDistance`, shared with the saved-workout
    /// read — one ride, one answer, whether it is live or in the history list.
    private func distanceMeters(from builder: HKLiveWorkoutBuilder) -> Double? {
        quantity(
            WorkoutDistance.identifier(forName: activePlan?.activityType), from: builder,
            unit: .meter())
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

    /// Test-only: seeds `session`/`publishedSession`/`epoch` directly so
    /// `WorkoutSessionOwnerEpochTests` can drive the real
    /// `HKWorkoutSessionDelegate` methods against known identity/epoch state,
    /// without a real HealthKit authorization round trip (non-deterministic)
    /// or a live delegate thread race (flaky — the roadmap ruled both out).
    /// Internal, not private — the same precedent as `permissionStatus`
    /// (ReactWatchHost.swift): safe in fact, a plain property write with no
    /// side effects, and it's the only way to reach this state from the test
    /// target. Called a second time mid-test, with the same `session` so
    /// identity is unchanged, to bump `epoch` alone — the
    /// call-time-vs-delivery-time race the fix closed.
    func testOnlySeedLiveSession(_ session: HKWorkoutSession, epoch: Int) {
        self.session = session
        self.publishedSession = session
        self.epoch = epoch
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
        //
        // The test is IDENTITY — is this the session JS was told about? — and
        // not a `claim` read, which cannot answer it: `endSession` clears
        // `claim` synchronously, so it is already nil when the explicit
        // session's own terminal callback lands. The `|| toState == .ended`
        // escape hatch that used to stand in for it is what let an externally
        // killed PUMP publish an "ended" at an app that started no workout: its
        // `didFailWithError` is followed by a trailing `didChangeTo(.ended)`
        // (Apple documents that order), and that session was never ours to
        // detach, so the teardown-site detach could not reach it either.
        // Clearing the name on the terminal transition is also what stops an
        // outside kill publishing "ended" TWICE — once from the failure, once
        // from the transition behind it.
        // `epoch(of:)` reads `session`/`epoch` — mutable state written only
        // from main — so it's computed AFTER the hop, not before: HealthKit
        // calls this delegate off-main, and reading those properties on that
        // thread would race every main-queue write to them (a torn/stale
        // read, TSan-flaggable). Every other mutable read in this class
        // already hops first (see `emitMetricsIfDue`'s caller below); this
        // brings the two delegate entry points in line with that.
        nonisolated(unsafe) let this = self
        DispatchQueue.main.async {
            let epoch = this.epoch(of: session)
            guard session === this.publishedSession else { return }
            let name = Self.stateName(toState)
            if name == .ended { this.publishedSession = nil }
            this.emitState(name.rawValue, nil, epoch)
        }
    }

    func workoutSession(
        _ session: HKWorkoutSession, didFailWithError error: Error
    ) {
        // See the didChangeTo comment above: epoch(of:) moves inside the
        // main-queue hop so it never reads session/epoch off-main.
        nonisolated(unsafe) let this = self
        DispatchQueue.main.async {
            let epoch = this.epoch(of: session)
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
            // Published only for the session JS knows about, same rule as the
            // transition above. A killed PUMP is fully invisible here: JS never
            // saw it start, so it must not see it die — and it doesn't need to,
            // because `sensor.heartRate` recovers on its own (the owner's
            // `wantHeartRate` survives, and `resumeHeartRateIfWanted` brings the
            // pump back at the next foreground — the one moment when re-taking
            // the slot is both legal and wanted, since the app that took it had
            // to be frontmost).
            guard session === this.publishedSession else { return }
            this.publishedSession = nil
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
