import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  healthQuantityTypes,
  hostMethods,
  invokeShapes,
} from "../codegen/schema";
import { HOST_FEATURES } from "../src/generated/wire";
import { HEALTH_UPDATE_EVENT_PREFIX } from "../src/health";
import type { SensorKind } from "../src/sensors";

/**
 * Negative checks for the guards the HEALTH package adds — the cases each one
 * exists to REFUSE, rather than the happy path the feature tests already cover.
 *
 * Several of them live in `#if os(watchOS)` code no Linux job can compile, so
 * they are scanned textually, the way `codegen.test.ts` scans the invoke router
 * and `invoke-producer-keys.test.ts` scans the response producers. A textual
 * scan is weaker than a compile, and stronger than the nothing these rules had.
 */

const swiftRoot = join(__dirname, "../swift/Sources");
const read = (rel: string) => readFileSync(join(swiftRoot, rel), "utf8");
/** The JS half, read as SOURCE — the few rules below that pin a JS string
 *  against a Swift one have to see both as text or they pin nothing. */
const healthTs = () =>
  readFileSync(join(__dirname, "../src/health.ts"), "utf8");

describe("the sensor union and the Swift switch cannot half-widen", () => {
  // A Record keyed by the union, not a list: adding a member to `SensorKind`
  // without adding it here fails to compile (the `INVOKE_ERROR_CODES` pattern
  // from invoke.ts). That makes the scan below a genuine both-directions gate
  // rather than a restatement of whatever the Swift file happens to say.
  const ALL_SENSOR_KINDS: Record<SensorKind, true> = {
    heartRate: true,
    motion: true,
    gyroscope: true,
    location: true,
    pedometer: true,
  };

  it("SensorBridge.handleOp starts and stops exactly the declared kinds", () => {
    // THE HAZARD: `handleOp`'s switch ends in `default: break` — deliberate
    // forward-compat for a newer bundle — so a kind added to the TS union with
    // no Swift case compiles, type-checks, lints, passes every JS test, and
    // silently starts nothing forever. `startSensor("steps")` was that bug once
    // (commit 2fd7739 closed the `| string` half); this closes the other half,
    // which the @ts-expect-error compile guard structurally cannot see.
    const src = read("ReactWatchHost/SensorBridge.swift");
    const started = new Set<string>();
    const stopped = new Set<string>();
    for (const m of src.matchAll(/case \("start", "(\w+)"\)/g)) {
      started.add(m[1] as string);
    }
    for (const m of src.matchAll(/case \("stop", "(\w+)"\)/g)) {
      stopped.add(m[1] as string);
    }
    const declared = Object.keys(ALL_SENSOR_KINDS).sort();
    expect([...started].sort()).toEqual(declared);
    expect([...stopped].sort()).toEqual(declared);
  });
});

describe("the workout owner is the only HKWorkoutSession construction site", () => {
  it("no other host source constructs one", () => {
    // The invariant the whole unification exists for: watchOS runs ONE workout
    // session per process and "if a second workout starts while your workout is
    // running, your session receives an error, and your session ends". A second
    // `HKWorkoutSession(` anywhere in the host is that bug, and its symptom is
    // the user's heart-rate stream dying mid-workout — which no test on this
    // machine could otherwise catch.
    const hostFiles = [
      "ReactWatchHost/SensorBridge.swift",
      "ReactWatchHost/ReactWatchHost.swift",
      "ReactWatchHost/CapabilityBridges.swift",
      "ReactWatchHost/HealthQueryBridge.swift",
      "ReactWatchHost/PedometerBridge.swift",
      // The newest neighbour, and the likeliest future offender: a file named
      // `WorkoutPlanBridge` sitting next to `WorkoutBridge` is exactly where
      // someone would reach for the session to "start the plan". WorkoutKit is
      // a document API and takes no session at all.
      "ReactWatchHost/WorkoutPlanBridge.swift",
    ];
    for (const file of hostFiles) {
      expect(
        read(file),
        `${file} constructs its own HKWorkoutSession`,
      ).not.toMatch(/try HKWorkoutSession\(/);
    }
    expect(read("ReactWatchHost/WorkoutBridge.swift")).toMatch(
      /try HKWorkoutSession\(/,
    );
  });

  it("SensorBridge delegates the heart-rate claim instead of owning a session", () => {
    const src = read("ReactWatchHost/SensorBridge.swift");
    expect(src).toContain("workoutOwner?.claimHeartRate()");
    expect(src).toContain("workoutOwner?.releaseHeartRate()");
    // The background rule lives in ONE place — the owner, which is the only
    // code that can see both claims — so the keepAlive flag is passed through
    // rather than acted on twice.
    expect(src).toContain("workoutOwner?.pauseForBackground(keepAlive:");
    expect(src).not.toContain("HKLiveWorkoutBuilderDelegate");
  });

  it("teardown ends the workout BEFORE the sensor claim and the runtime (ARCH-08)", () => {
    // Ordering is the point, and this order is the opposite of the one that
    // shipped. `sensors.stopAll()` -> `stopHeartRate()` -> `releaseHeartRate()`
    // ends the heart-rate pump itself and nils the owner's session, after which
    // `tearDownForReload()` returns on its `guard session != nil` BEFORE
    // `detachDelegates()` — so the outgoing session keeps the owner as its
    // delegate and its trailing `.ended` (and a late `didCollectDataOf`) push a
    // stale `workout.state` / `sensor.heartRate` into the runtime `boot()` is
    // about to install, which `pushNativeEvent` name-routes with no generation
    // guard. Running the workout teardown first is what makes this file's
    // "the delegate is detached first" comment true, and it is also what makes
    // the owner's pump-only (`wasWorkout == false`) branch reachable at all.
    // The session must still be released before QuickJS goes away.
    const src = read("ReactWatchHost/ReactWatchHost.swift");
    // Comments stripped first: the ordering rule is spelled out in a comment
    // that names `sensors.stopAll()` above the call it orders against, and an
    // index scan would otherwise match the prose instead of the code.
    const teardown = src
      .slice(src.indexOf("private func tearDownGeneration() {"))
      .replace(/^\s*\/\/.*$/gm, "");
    const sensors = teardown.indexOf("sensors.stopAll()");
    const workout = teardown.indexOf("workout.tearDownForReload()");
    const shutdown = teardown.indexOf("runtime?.shutdown()");
    expect(workout).toBeGreaterThan(-1);
    expect(sensors).toBeGreaterThan(workout);
    expect(shutdown).toBeGreaterThan(sensors);
  });

  it("the UPGRADE ends the pump before building the configured session", () => {
    // The transition the whole file exists for, and it shipped unimplemented:
    // `start()` is idempotent against a live session (`guard session == nil`,
    // its real double-auth-completion guard), so a `startWorkout` over a live
    // pump was accepted, then silently dropped — no session, no delegate
    // callback, and the parked invoke hanging to its 30 s watchdog. The end
    // has to happen in the authorization completion, the only call site that
    // can reach `start()` with a session already live, and BEFORE the new
    // session per Apple ("if a second workout starts while your workout is
    // running ... your session ends" would kill the one we are starting).
    const src = read("ReactWatchHost/WorkoutBridge.swift");
    const window = src.slice(
      src.indexOf(
        "healthStore.requestAuthorization(toShare: share, read: read)",
      ),
      src.indexOf("func pauseWorkout()"),
    );
    const end = window.indexOf("this.endSession(");
    const start = window.indexOf("this.start(configuration: configuration");
    expect(end).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(end);
  });

  it("a start parked in the authorization window is cancellable", () => {
    // `endWorkout` guards on a live session, which does not exist yet for the
    // whole HealthKit round trip — so the cancel was refused ("no workout is
    // running") while `isWorkoutActive` was simultaneously true, and the
    // workout started anyway once the sheet completed. Clearing `pendingStart`
    // is what makes the auth completion drop it; the terminal emit is what
    // settles the parked invoke, since a session that was never created can
    // produce no callback of its own.
    const src = read("ReactWatchHost/WorkoutBridge.swift");
    const body = src.slice(
      src.indexOf("func endWorkout("),
      src.indexOf("func tearDownForReload()"),
    );
    const cancel = body.indexOf("if pendingStart != nil {");
    const guardLive = body.indexOf("guard claim == .workout, session != nil");
    expect(cancel).toBeGreaterThan(-1);
    expect(guardLive).toBeGreaterThan(cancel);
    expect(body).toContain(
      "endWorkout() was called while it was still starting",
    );
  });

  it("the pump's teardown stays invisible to the workout API", () => {
    // `workout.state` and `getWorkoutState()` describe the EXPLICIT session
    // only — the pump is an implementation detail of `startHeartRate` and JS
    // never saw it start. Neither can be enforced at the delegate: `claim` is
    // already nil when `didChangeTo(.ended)` lands, for the explicit session
    // too, which is why the `.ended` escape hatch exists. So the teardown site
    // has to answer it: detach the pump's SESSION delegate (never the
    // builder's — the dying pump's last readings still owe `sensor.heartRate`
    // a sample), and skip `recordEnded`, or a plain `stopHeartRate()` leaves
    // `getWorkoutState()` reporting a finished workout forever.
    const src = read("ReactWatchHost/WorkoutBridge.swift");
    const body = src.slice(
      src.indexOf("private func endSession("),
      src.indexOf("private func restorePumpIfWanted()"),
    );
    expect(body).toContain("let wasPump = claim == .heartRate");
    expect(body).toContain("if wasPump { session.delegate = nil }");
    expect(body).toContain("if !wasPump {");
    expect(body).not.toContain("builder.delegate = nil");
  });

  it("the delegate publishes by session IDENTITY, not by a claim read", () => {
    // The rule the `|| toState == .ended` escape hatch used to stand in for,
    // and could not enforce: `endSession` clears `claim` synchronously, so it
    // is nil when the EXPLICIT session's own terminal callback lands — which
    // is why the disjunct existed, and why an externally killed PUMP published
    // a `workout.state: "ended"` at an app that started no workout. Its
    // `didFailWithError` is followed by a trailing `didChangeTo(.ended)` (the
    // order Apple documents), and that session was never ours to detach, so
    // the teardown-site detach could not reach it either. Naming the session
    // JS was told about is the only test that survives both.
    const src = read("ReactWatchHost/WorkoutBridge.swift");
    expect(src).toContain(
      "private weak var publishedSession: HKWorkoutSession?",
    );
    // Set at the ONE construction site, and only for the explicit claim.
    expect(src).toContain(
      "if claim == .workout { publishedSession = session }",
    );
    const code = src
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");
    // The escape hatch must be GONE, not merely supplemented: while it is
    // there, the identity check is dead weight and the leak is still open.
    expect(code).not.toContain("toState == .ended else { return }");
    const transitions = code.slice(
      code.indexOf("didChangeTo toState: HKWorkoutSessionState"),
      code.indexOf("didFailWithError error: Error"),
    );
    expect(transitions).toContain("guard session === this.publishedSession");
    // Cleared on the terminal transition — which is also what stops an outside
    // kill publishing "ended" twice, once per callback.
    expect(transitions).toContain(
      "if name == .ended { this.publishedSession = nil }",
    );
    const failure = code.slice(code.indexOf("didFailWithError error: Error"));
    expect(failure).toContain("guard session === this.publishedSession");
  });

  it("a pump that fails to START is invisible too", () => {
    // The same leak one door over: `start()`'s catch emits the terminal state
    // itself, because a throw produces no delegate callback and would hang a
    // parked invoke. No invoke is ever parked on a PUMP start, so emitting for
    // one publishes a workout ending to an app that started no workout.
    const src = read("ReactWatchHost/WorkoutBridge.swift");
    const start = src.slice(
      src.indexOf("    private func start("),
      src.indexOf("    /// The one teardown path."),
    );
    expect(start).toContain("if claim == .workout {");
    expect(start).toContain(
      'emitState("ended", error.localizedDescription, epoch)',
    );
  });

  it("crash recovery is scoped to the PROCESS, not to a runtime generation", () => {
    // The distinction the whole feature rests on. A runtime reload still ends
    // its workout deterministically — the process is alive and an incoming
    // bundle must not inherit a workout it never started — while recovery is
    // process DEATH, where no runtime exists to hand the session back to.
    // Calling it from boot() (which runs again on every reload) would blur
    // exactly that, and would re-adopt across a hot-reload loop.
    const host = read("ReactWatchHost/ReactWatchHost.swift");
    const code = host
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");
    const startFn = code.slice(
      code.indexOf("    func start() {"),
      code.indexOf("    private func boot("),
    );
    expect(startFn).toContain("workout.recoverOrphanedSession()");
    // Before boot(), so the pump deferral is armed before the bundle's first
    // startHeartRate can take the single slot.
    expect(startFn.indexOf("workout.recoverOrphanedSession()")).toBeLessThan(
      startFn.indexOf("boot()"),
    );
    const teardown = code.slice(
      code.indexOf("private func tearDownGeneration() {"),
    );
    expect(teardown).not.toContain("recoverOrphanedSession");
    // Exactly one call site in the whole host.
    expect(code.match(/recoverOrphanedSession\(\)/g) ?? []).toHaveLength(1);
  });

  it("the pump is deferred for the recovery window, and never dropped", () => {
    // A pump started inside the healthd round trip takes the single slot and,
    // by the same Apple rule this file exists for, ENDS the session being
    // recovered — losing the user's real workout to a heart-rate stream. The
    // guard sits at the one choke point every pump start goes through, so
    // claim / resume / restore are all covered by one line.
    const src = read("ReactWatchHost/WorkoutBridge.swift");
    const begin = src.slice(
      src.indexOf("    private func beginPumpSession() {"),
      src.indexOf("    // MARK: - Explicit workout"),
    );
    expect(begin).toContain("guard !recovering else { return }");
    // Deferred is only honest if something lifts it: the completion clears the
    // flag and restores on EVERY path, including "nothing to recover".
    const recover = src.slice(
      src.indexOf("    func recoverOrphanedSession() {"),
      src.indexOf("    private func adopt("),
    );
    expect(recover).toContain("this.recovering = false");
    expect(recover).toContain("this.restorePumpIfWanted()");
  });

  it("recovery adopts only when the single slot is free", () => {
    // A `startWorkout` from the freshly booted bundle can land inside the
    // window, and by Apple's rule that newer start has already ended the
    // recovered one. Ending it explicitly releases the daemon's handle instead
    // of leaving a session no code path can reach.
    // Comments stripped: the `beginCollection` assertion below is about the
    // CODE, and the comment above it explains why the call is absent.
    const src = read("ReactWatchHost/WorkoutBridge.swift")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");
    const adopt = src.slice(
      src.indexOf("    private func adopt(_ session: HKWorkoutSession) {"),
      src.indexOf("    deinit {"),
    );
    expect(adopt).toContain(
      "guard self.session == nil, pendingStart == nil else {",
    );
    expect(adopt).toContain("session.end()");
    // Apple: "you must access its builder and set up your data source and
    // delegates again" — all three, or the adopted session collects nothing
    // and reports nothing.
    expect(adopt).toContain("session.associatedWorkoutBuilder()");
    expect(adopt).toContain("builder.dataSource = HKLiveWorkoutDataSource(");
    expect(adopt).toContain("session.delegate = self");
    expect(adopt).toContain("builder.delegate = self");
    // It is a real workout to JS, so it is named for the delegate too.
    expect(adopt).toContain("publishedSession = session");
    // No beginCollection: the crashed launch already began it, and that data
    // is exactly what this recovers.
    expect(adopt).not.toContain("beginCollection");
  });

  it("no recovery entry point is left uncalled", () => {
    // `resumeHeartRateIfWanted()` was written, was correct, and had zero call
    // sites anywhere in the package — so a pump killed from OUTSIDE (Apple ends
    // ours when a second workout starts elsewhere) stayed dead forever with
    // `wantHeartRate` still true, and a DOWNGRADE parked while the app was
    // backgrounded never came back. A definition plus at least one call is the
    // shape that would have caught it.
    const sources = [
      read("ReactWatchHost/WorkoutBridge.swift"),
      read("ReactWatchHost/SensorBridge.swift"),
      read("ReactWatchHost/ReactWatchHost.swift"),
    ].join("\n");
    const mentions = sources.match(/resumeHeartRateIfWanted/g) ?? [];
    expect(mentions.length).toBeGreaterThan(1);
    expect(read("ReactWatchHost/SensorBridge.swift")).toContain(
      "workoutOwner?.resumeHeartRateIfWanted()",
    );
    // Same shape for the crash-recovery entry point, which has the same
    // failure mode: written, correct, and reachable from nothing.
    expect(
      (sources.match(/recoverOrphanedSession/g) ?? []).length,
    ).toBeGreaterThan(1);
  });

  it("the DOWNGRADE cannot revive the background heart-rate drain", () => {
    // `pauseForBackground` only ends a session that exists at the moment of
    // backgrounding; the DOWNGRADE runs later, when the save settles. A workout
    // ended while the app is away would otherwise start a fresh `.other`
    // session that re-grants background execution and re-arms HR sampling —
    // the exact drain `keepAliveInBackground: false` asked to avoid, through
    // the one door the backstop does not watch.
    const src = read("ReactWatchHost/WorkoutBridge.swift");
    expect(src).toContain("private var pumpBlockedByBackground = false");
    const restore = src.slice(
      src.indexOf("private func restorePumpIfWanted()"),
      src.indexOf("private func recordEnded("),
    );
    expect(restore).toContain("guard !pumpBlockedByBackground else { return }");
  });

  it("route GPS stops on every terminal session state, not just endWorkout", () => {
    // `endWorkout` is not the only way a session dies — Apple ends ours when
    // another app starts a workout, a start that throws never reaches the
    // endWorkout completion, and a start cancelled inside the auth window never
    // had a session. The route runs the GPS at kCLLocationAccuracyBest with no
    // distance filter, and the stranded `routeTracking` latch also makes the
    // app's own `stopLocation()` a permanent no-op. The `isWorkoutActive` guard
    // is what keeps a stale "ended" from stopping a route that has since
    // started (the UPGRADE makes that ordering reachable).
    const src = read("ReactWatchHost/ReactWatchHost.swift");
    const closure = src.slice(
      src.indexOf("workout.onState = { [weak self] state, reason, epoch in"),
      src.indexOf("workout.onMetrics ="),
    );
    expect(closure).toContain('if state == "ended"');
    expect(closure).toContain("self?.workout.isWorkoutActive == false");
    expect(closure).toContain("self?.sensors.stopRouteTracking()");
  });

  it("sensor.heartRate is gated on the subscription, not on the workout", () => {
    // `sensor.heartRate` is `startHeartRate`'s stream. An explicit workout
    // collects heart rate whether or not anyone subscribed, so ungated this
    // pushed one listener-less event per collected sample (~1 Hz) for the whole
    // workout — the per-sample bridge cost `emitMetricsIfDue` coalescing exists
    // to avoid. `workout.metrics.heartRateBpm` is the in-workout channel.
    const src = read("ReactWatchHost/WorkoutBridge.swift");
    expect(src).toContain(
      "if this.wantHeartRate, let heartRate { this.onHeartRate?(heartRate) }",
    );
  });

  it("keeps the deinit backstop that releases the system slot", () => {
    // The safety property P0-3 bought: a discarded owner must not leak the
    // daemon-owned session. Losing this regresses a fixed bug silently.
    const src = read("ReactWatchHost/WorkoutBridge.swift");
    const deinitBody = src.slice(src.indexOf("    deinit {"));
    expect(deinitBody).toContain("session?.end()");
  });
});

describe("refusals that produce no delegate callback are synchronous", () => {
  it("startWorkout refuses a second workout, an unknown activity and no HealthKit", () => {
    // Each of these returns a message the handler rejects with IMMEDIATELY.
    // The `ExtendedRuntimeBridge.start() -> Bool` lesson: an asynchronous API
    // whose refusal fires no callback leaves the parked invoke hanging to its
    // 30 s watchdog, which reads to the caller as a hung app.
    const src = read("ReactWatchHost/WorkoutBridge.swift");
    const body = src.slice(
      src.indexOf("func startWorkout(_ plan: WorkoutStartPlan) -> String? {"),
    );
    expect(body).toContain("HealthKit is not available on this device");
    expect(body).toContain("unknown workout activityType");
    expect(body).toContain("a workout is already running");
  });

  it("pause/resume/end refuse when there is nothing to act on", () => {
    // Rule 12: "nothing to pause" is a refusal, not a silent success.
    const src = read("ReactWatchHost/ReactWatchHost.swift");
    expect(src).toContain("no running workout to pause");
    expect(src).toContain("no paused workout to resume");
    expect(src).toContain("no workout is running");
  });

  it("collectRoute is denied POLICY_DENIED naming the location feature", () => {
    // The one cross-feature check. ARCH-07 gates one feature per method by
    // design, so this is an explicit in-body check rather than a second method
    // whose only job is flipping a bool — and it must NAME `location`, or the
    // consumer cannot tell which grant to add.
    const src = read("ReactWatchHost/ReactWatchHost.swift");
    const body = src.slice(
      src.indexOf(
        "private func handleStartWorkout(id: Int, payload: String) {",
      ),
    );
    expect(body).toContain('effectiveFeatures.contains("location")');
    expect(body).toContain("code: .policyDenied");
    expect(body).toContain("'location' feature");
  });

  it("queryPedometer refuses rather than hitting Apple's documented crash", () => {
    // Apple: calling CMPedometer with no NSMotionUsageDescription CRASHES the
    // app. The guard is what makes `motion: false` a safe plugin default, so
    // the two must not be separated.
    const bridge = read("ReactWatchHost/PedometerBridge.swift");
    expect(bridge).toContain(
      'Bundle.main.object(forInfoDictionaryKey: "NSMotionUsageDescription")',
    );
    // The message has to name the fix, not just the symptom.
    expect(bridge).toContain("`motion: true`");
    const host = read("ReactWatchHost/ReactWatchHost.swift");
    expect(host).toContain("PedometerBridge.missingUsageDescriptionMessage");
  });
});

describe("the bucketed statistics collections are contiguous, not sparse", () => {
  it("enumerates every interval instead of only the ones with samples", () => {
    // `HKStatisticsCollection.statistics()` skips intervals with no samples
    // ("there may be arbitrarily large gaps"), so a week the user rested twice
    // would come back as five buckets and every caller would re-derive which
    // days were missing. `enumerateStatistics(from:to:)` calls the block once
    // per interval with a nil-valued quantity, which is exactly the
    // `value: null` the scalar query already means. That is the difference
    // between "results.length is the number of buckets you asked for" and not.
    const src = read("ReactWatchHost/HealthQueryBridge.swift");
    const body = src.slice(src.indexOf("private func bucketedStatistics("));
    expect(body).toContain("collection.enumerateStatistics(");
    expect(body).not.toContain("collection.statistics()");
    // Anchored on the caller's own window start — that is what keeps the time
    // zone in JS, where the calendar actually is — with the stride as the ONE
    // parameter, so the two granularities cannot drift on anything else.
    expect(body).toContain("anchorDate: plan.window.start");
    expect(body).toContain("intervalComponents: stride");
    // The off-by-one Apple's contract introduces (the final interval is the
    // one CONTAINING the end date) is dropped by the Linux-tested rule, not
    // re-derived here.
    expect(body).toContain("window.containsBucketStart(startMs)");
  });

  it("the two public wrappers differ ONLY in the stride they pass", () => {
    // The method name is the granularity, so each wrapper is one line handing
    // the shared implementation its stride — a second hand-written descriptor
    // is exactly the drift surface the shared body exists to remove.
    const src = read("ReactWatchHost/HealthQueryBridge.swift");
    expect(src).toContain(
      "await bucketedStatistics(plan, stride: DateComponents(day: 1))",
    );
    expect(src).toContain(
      "await bucketedStatistics(plan, stride: DateComponents(hour: 1))",
    );
    // ... and the HOURLY handler decodes through the hourly ceiling. The
    // shared bridge body cannot check this (it never sees the raw JSON), so
    // the host routing is where a laxer second door would open.
    const host = read("ReactWatchHost/ReactWatchHost.swift");
    const hourly = host.slice(
      host.indexOf(
        "private func handleQueryHealthHourlyStatistics(id: Int, payload: String) {",
      ),
      host.indexOf(
        "private func handleQueryHealthSamples(id: Int, payload: String) {",
      ),
    );
    expect(hourly).toContain(
      "HealthStatisticsPlan.decodeHourly(json: payload)",
    );
    expect(hourly).toContain("bridge.hourlyStatistics(plan)");
  });

  it("shares one statistic->quantity table with the scalar query", () => {
    // Two hand-written switches would both compile while answering "average"
    // with different accessors, and no fixture could tell.
    const src = read("ReactWatchHost/HealthQueryBridge.swift");
    expect(src).toContain(
      "private static func quantity(\n        _ statistic: HealthStatistic, from statistics: HKStatistics\n    ) -> HKQuantity? {",
    );
    expect(src.match(/Self\.quantity\(/g) ?? []).toHaveLength(2);
  });
});

describe("the read vocabulary cannot half-widen into the host bridge", () => {
  const src = read("ReactWatchHost/HealthQueryBridge.swift");

  it("every declared quantity type has a HealthKit type AND a unit", () => {
    // THE HAZARD: both switches live in `#if os(watchOS)` code no Linux job
    // compiles, so a type added to the schema (and therefore to the Support
    // enum, which `codegen.test.ts` pins) with no case here is green on CI and
    // a build failure only on device — the same half-widen the SensorKind scan
    // at the top of this file closes, one door over.
    const cases = (from: string, to: string) => {
      const body = src.slice(src.indexOf(from), src.indexOf(to));
      return [...body.matchAll(/case \.(\w+):/g)].map((m) => m[1]).sort();
    };
    const declared = [...healthQuantityTypes].sort();
    expect(
      cases("static func quantityType(for kind:", "/// The unit each type"),
    ).toEqual(declared);
    expect(
      cases("static func unit(for kind:", "/// The sleep-analysis"),
    ).toEqual(declared);
    // Presence is not enough: an arm must READ the type it is NAMED for.
    // `case .restingHeartRate: HKQuantityType(.heartRate)` — the slip a
    // duplicated arm invites — compiles, satisfies the two checks above, and
    // ships instantaneous heart rate under a resting-heart-rate label.
    const arms = [...src.matchAll(/case \.(\w+): HKQuantityType\(\.(\w+)\)/g)];
    expect(arms.map((m) => m[1]).sort()).toEqual(declared);
    for (const [, kind, identifier] of arms) expect(identifier).toBe(kind);
  });

  it("names and measures the same unit for every read type", () => {
    // The Support side NAMES the unit and the Host side MEASURES it. They
    // compile independently, so a mismatch ships a chart that LIES rather than
    // failing a build — which is why every pair is pinned here, not just the
    // one that most recently moved.
    const UNITS: Record<string, [hk: string, wire: string]> = {
      stepCount: ["HKUnit.count()", "count"],
      activeEnergyBurned: ["HKUnit.kilocalorie()", "kcal"],
      distanceWalkingRunning: ["HKUnit.meter()", "m"],
      heartRate: ["HKUnit.count().unitDivided(by: .minute())", "count/min"],
      oxygenSaturation: ["HKUnit.percent()", "fraction"],
      // SDNN in seconds would type-check, ship, and report 0.045 where the
      // Health app shows 45 — under a label that still said "ms".
      heartRateVariabilitySDNN: ["HKUnit.secondUnit(with: .milli)", "ms"],
      restingHeartRate: [
        "HKUnit.count().unitDivided(by: .minute())",
        "count/min",
      ],
      appleExerciseTime: ["HKUnit.minute()", "min"],
      basalEnergyBurned: ["HKUnit.kilocalorie()", "kcal"],
      respiratoryRate: [
        "HKUnit.count().unitDivided(by: .minute())",
        "count/min",
      ],
      flightsClimbed: ["HKUnit.count()", "count"],
      // The one compound unit with three components to get wrong. Apple says
      // the watch estimates the 14-60 range, so a slipped prefix (litres, or
      // grams) reports 0.045-style nonsense under a label that still says
      // ml/kg/min.
      vo2Max: [
        "HKUnit.literUnit(with: .milli).unitDivided(by: HKUnit.gramUnit(with: .kilo).unitMultiplied(by: HKUnit.minute()))",
        "ml/kg/min",
      ],
      walkingHeartRateAverage: [
        "HKUnit.count().unitDivided(by: .minute())",
        "count/min",
      ],
      appleStandTime: ["HKUnit.minute()", "min"],
      appleMoveTime: ["HKUnit.minute()", "min"],
    };
    expect(Object.keys(UNITS).sort()).toEqual([...healthQuantityTypes].sort());
    const support = read("ReactWatchSupport/HealthQueryPlan.swift");
    // Each arm is extracted WHOLE and compared exactly, rather than searched
    // for as a substring. Two reasons, both of which a `toContain` gets wrong:
    // `vo2Max`'s expression is past swift-format's 100 columns, so the arm is
    // WRAPPED in the source and only a whitespace-insensitive match sees it;
    // and a substring match is satisfied by a PREFIX, so an arm silently
    // extended to `HKUnit.count().unitDivided(by: .minute())` would still pass
    // under a wire label that still said "count". Line comments go first —
    // flattening newlines away would weld a comment onto the arm below it, and
    // a needle satisfied from inside a comment pins nothing.
    const flat = (text: string) => text.replace(/\s+/g, "");
    const arms = (text: string, from: string, to: string) => {
      const body = text
        .slice(text.indexOf(from), text.indexOf(to))
        .replace(/\/\/[^\n]*/g, "");
      const marks = [...body.matchAll(/case \.(\w+):/g)];
      return Object.fromEntries(
        marks.map((m, i) => [
          m[1],
          // The last arm's slice runs into the switch's closing braces.
          flat(
            body.slice(
              m.index + m[0].length,
              i + 1 < marks.length ? marks[i + 1].index : body.length,
            ),
          ).replace(/\}+$/, ""),
        ]),
      );
    };
    const measured = arms(
      src,
      "static func unit(for kind:",
      "/// The sleep-analysis",
    );
    const named = arms(
      support,
      "public var unit: String {",
      "/// The statistic a",
    );
    for (const [kind, [hk, wire]] of Object.entries(UNITS)) {
      expect(measured[kind]).toBe(flat(hk));
      expect(named[kind]).toBe(flat(`"${wire}"`));
    }
  });
});

describe("the saved-workout read is a HISTORY read", () => {
  it("is gated by `health`, never by `workouts`", () => {
    // The authorization-unit rule, stated where it can fail: `workouts`
    // authorizes RECORDING one workout — a write, background execution and the
    // single session slot — while this discloses every workout the user has,
    // including ones other apps saved. Filing it under `workouts` would let an
    // app that asked to record a run read years of history instead, which is
    // the exact mismatch ARCH-07 split the two features to prevent.
    const history = hostMethods.find((m) => m.name === "queryWorkoutHistory");
    expect(history?.feature).toBe("health");
    expect(history?.targets).toEqual(["watch"]);
  });

  it("reads energy and distance the un-deprecated way, and never guesses zero", () => {
    // `HKWorkout.totalEnergyBurned` / `.totalDistance` are DEPRECATED (watchOS
    // 11.0 / 27.0) and they also answer the wrong question: they cannot
    // distinguish "no samples" from zero. `statistics(for:)` returns nil for a
    // workout that measured nothing, which is what rides the wire as `null`.
    // Neither half compiles on Linux, so this is the only gate before a device.
    const src = read("ReactWatchHost/HealthQueryBridge.swift");
    const body = src.slice(
      src.indexOf("func workoutHistory(_ plan: WorkoutHistoryPlan)"),
      src.indexOf("private static func total("),
    );
    expect(body).toContain("Self.total(");
    expect(body).toContain("NSNull()");
    expect(src).toContain("workout.statistics(for: type)?.sumQuantity()");
    // The VALIDATED plan is what the query runs on. Nothing here compiles on
    // Linux, so a bridge that decoded the window and then queried a hardcoded
    // range — or dropped the cap and pulled a year of workouts into a watch's
    // memory — would pass every other gate in this file.
    expect(body).toContain(
      "withStart: plan.window.start, end: plan.window.end",
    );
    expect(body).toContain("plan.window.limit ?? HealthWindow.maxLimit");
    // Comments stripped first: both deprecated names are NAMED in the doc
    // comment that explains why they are not used, so scanning the raw file
    // would match the prose that documents the rule instead of a violation.
    const code = src.replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toContain("totalEnergyBurned");
    expect(code).not.toContain("totalDistance");
    // The activity name comes from the GENERATED table, read backwards — a
    // second hand-written mapping is a second thing to drift, and this one
    // would mislabel a stranger's workout rather than fail.
    expect(body).toContain("WorkoutActivityName.name(");
  });

  it("reads distance under the type the ACTIVITY records it in", () => {
    // HealthKit has no single "distance": a ride's metres are
    // `distanceCycling`, a swim's are `distanceSwimming`. A fixed
    // `distanceWalkingRunning` read therefore reports null for every ride in
    // the list — indistinguishable, on the wire, from the yoga session the
    // field's own JSDoc says null means. The live workout already knew this
    // rule, which is the point of the assertions below: ONE table, so the same
    // ride cannot report 12 km while it runs and "—" once it is saved.
    const history = read("ReactWatchHost/HealthQueryBridge.swift");
    const body = history.slice(
      history.indexOf("func workoutHistory(_ plan: WorkoutHistoryPlan)"),
      history.indexOf("private static func total("),
    );
    expect(body).toContain("WorkoutDistance.identifier(");
    // Comments stripped first, like the sibling check above: every rule here
    // is NAMED in the prose that explains it.
    const code = (rel: string) => read(rel).replace(/^\s*\/\/.*$/gm, "");
    // The table lives in exactly one file: neither bridge may spell a distance
    // identifier of its own.
    for (const rel of [
      "ReactWatchHost/HealthQueryBridge.swift",
      "ReactWatchHost/WorkoutBridge.swift",
    ]) {
      expect(code(rel)).not.toContain(".distanceCycling");
      expect(code(rel)).not.toContain(".distanceSwimming");
    }
    const table = code("ReactWatchHost/WorkoutDistanceType.swift");
    for (const arm of [
      "case .cycling, .handCycling: .distanceCycling",
      "case .swimming: .distanceSwimming",
      "case .wheelchairWalkPace, .wheelchairRunPace: .distanceWheelchair",
      "default: .distanceWalkingRunning",
    ]) {
      expect(table).toContain(arm);
    }
    // watchOS 11.0 types, above this package's v10 floor: in the table they
    // would need an `@available` gate the package does not have anywhere.
    for (const above of [
      "distanceRowing",
      "distancePaddleSports",
      "distanceCrossCountrySkiing",
      "distanceSkatingSports",
    ]) {
      expect(table).not.toContain(`.${above}`);
    }
  });

  it("puts the workout type through the same authorization door as sleep", () => {
    // `HKObjectType.workoutType()` is neither a quantity nor a category type,
    // so it can only reach the sheet through its own flag — and the query must
    // request it itself, or a caller who never called
    // requestHealthAuthorization gets a silently empty list instead of a
    // prompt (the rule every other read in this file follows).
    const src = read("ReactWatchHost/HealthQueryBridge.swift");
    expect(src).toContain(
      "if plan.workoutHistory { types.formUnion(Self.workoutHistoryTypes) }",
    );
    expect(src).toContain("await ensureRequested(Self.workoutHistoryTypes)");
    // And the set is the workout type PLUS what the summary actually reads.
    // `HKWorkout.statistics(for:)` is computed from the quantity samples
    // associated with the workout, each authorized on its own, so a request
    // for the workout type alone risks every row reporting null energy and
    // null distance under a grant the user was never asked for.
    const types = src.slice(
      src.indexOf("static var workoutHistoryTypes"),
      src.indexOf("static func stage(forCategoryValue"),
    );
    expect(types).toContain(
      "[workoutType, HKQuantityType(.activeEnergyBurned)]",
    );
    expect(types).toContain("WorkoutDistance.allIdentifiers");
  });
});

describe("the rings read is keyed by DAY, and the goals are the point", () => {
  const bridge = () => read("ReactWatchHost/HealthQueryBridge.swift");
  /** The query's body: decl -> the next member. */
  const body = () => {
    const src = bridge();
    return src.slice(
      src.indexOf(
        "func activitySummaries(_ plan: ActivitySummariesPlan) async -> Outcome {",
      ),
      src.indexOf("static func moveMode(for mode:"),
    );
  };
  /** Comments stripped: every rule below is NAMED in the prose that explains
   *  it, so scanning the raw file would match the documentation of a rule
   *  instead of a violation of it. */
  const code = () => bridge().replace(/^\s*\/\/.*$/gm, "");

  it("is gated by `health`, watch-only, like its sibling reads", () => {
    const rings = hostMethods.find((m) => m.name === "queryActivitySummaries");
    expect(rings?.feature).toBe("health");
    expect(rings?.targets).toEqual(["watch"]);
  });

  it("builds the day predicate from the VALIDATED plan, never its own", () => {
    // THE silent-failure hazard of this whole method. Activity summaries match
    // by `DateComponents` identifying a day as the user perceives it, and Apple
    // requires those components to carry a `calendar` — a set without one
    // matches NOTHING, with no throw and no error: the caller just sees `[]`
    // and reads it as "you have no rings". So the components are built ONCE, in
    // ReactWatchSupport where `swift test` proves the calendar is attached
    // (`ActivityDay.components`), and this file pins that the watchOS bridge —
    // which no Linux job can compile — assembles none of its own.
    expect(body()).toContain(
      "forActivitySummariesBetweenStart: plan.start.components",
    );
    expect(body()).toContain("end: plan.end.components");
    // Scoped to this read's own code: `queryHealthDailyStatistics` builds a
    // `DateComponents(day: 1)` a few lines up as a bucket INTERVAL, which is a
    // different thing entirely (a length, not a day).
    expect(body()).not.toContain("DateComponents(");
    expect(body()).not.toContain(".calendar =");
    // Nor its own calendar: `ActivityDay.calendar` is gregorian-by-identifier
    // for both directions, so the day the query ASKS for and the day read back
    // off the answer cannot be resolved by two different calendars. A
    // `Calendar.current` here would also follow a Buddhist or Japanese-era
    // locale and report year 2569 into a date string nothing can plot.
    expect(code()).not.toContain("Calendar(");
    expect(code()).not.toContain("Calendar.current");
    // Bound ONCE for the whole answer: `ActivityDay.calendar` is computed (it
    // re-reads the system zone rather than freezing it at first use), so a
    // thousand-row answer is dated by one zone rather than by whatever the
    // wrist was in per row.
    expect(body()).toContain("let calendar = ActivityDay.calendar");
    expect(body()).toContain("summary.dateComponents(for: calendar)");
  });

  it("reads the LIVE goal spellings and carries a missing one as null", () => {
    // The goals ARE the feature: no quantity type exposes one, so a ring could
    // not be drawn before this read. Both live spellings are watchOS 9.0
    // OPTIONALS — `exerciseTimeGoal` and `standHoursGoal` — and a nil one is a
    // real state that must cross as `null`; substituting Apple's default would
    // draw a ring the user was never scored against.
    expect(body()).toContain("summary.exerciseTimeGoal");
    expect(body()).toContain("summary.standHoursGoal");
    expect(body()).toContain("summary.activeEnergyBurnedGoal");
    expect(body()).toContain("summary.appleMoveTimeGoal");
    expect(code()).toContain("?? NSNull()");
    // The DEPRECATED spellings (both deprecated at watchOS 27.0) report the
    // same two rings and must never be the ones read.
    expect(code()).not.toContain("appleExerciseTimeGoal");
    expect(code()).not.toContain("appleStandHoursGoal");
    // watchOS 11.0, above this package's v10 floor: reading it would need the
    // first `@available` gate in a package that has none.
    expect(code()).not.toContain("isPaused");
    // The descriptor family, not the legacy callback class — whose docs JSON
    // carries no availability at all.
    expect(code()).toContain("HKActivitySummaryQueryDescriptor(");
    expect(code()).not.toContain("HKActivitySummaryQuery(");
  });

  it("asks for the summary type ALONE, through its own flag", () => {
    // `HKObjectType.activitySummaryType()` is neither a quantity nor a category
    // type, so like sleep it can only reach the sheet through a flag of its
    // own — and the query requests it itself, or a caller who never ran the
    // sheet gets a silently empty week instead of a prompt.
    const src = bridge();
    expect(src).toContain(
      "if plan.activitySummaries { types.insert(Self.activitySummaryType) }",
    );
    expect(src).toContain("await ensureRequested([Self.activitySummaryType])");
    // And ONE row, deliberately unlike `workoutHistoryTypes` next door: a
    // summary is a single object HealthKit hands over whole, goals included —
    // there are no per-sample grants behind it to widen the ask for.
    expect(body()).not.toContain("HKQuantityType(");
    expect(body()).not.toContain("workoutHistoryTypes");
  });

  it("drops a row it cannot date or cannot name the move ring of", () => {
    // Both unknowns are unrenderable rather than approximable: a summary with
    // no readable day is a bar with nowhere to go, and a move mode this binary
    // cannot name would be drawn as the WRONG ring. The sleep read already
    // established the posture (an unrecognized category value is dropped, never
    // mapped to a neighbour) — a missing day reads as missing, a mislabelled
    // one reads as a lie.
    expect(body()).toContain(
      "summary -> (day: ActivityDay, row: [String: Any])? in",
    );
    expect(body()).toContain("else { return nil }");
    // Mapped by CASE, like every other Apple enum this bridge maps: the raw
    // integers are undocumented, and `@unknown default` must refuse rather than
    // fall back to energy.
    const modes = code().slice(
      code().indexOf("static func moveMode(for mode:"),
    );
    expect(modes).toContain("case .activeEnergy: .activeEnergy");
    expect(modes).toContain("case .appleMoveTime: .appleMoveTime");
    expect(modes).toContain("@unknown default: nil");
  });

  it("returns the days in a deterministic OLDEST-FIRST order", () => {
    // `HKActivitySummaryQueryDescriptor.init(predicate:)` takes no sort
    // descriptors, and Apple documents `result(for:)` only as "a snapshot of
    // the current matching results" — no ordering promise at all. Every sibling
    // read passes `SortDescriptor(\.startDate, order: .reverse)` and says
    // "newest first" in its JSDoc; this one has no descriptor to pass, so the
    // order has to be imposed after the fact or the seven-bar chart every
    // caller draws is correct only by luck. Ascending here, unlike the sample
    // reads, because a ring history is read left to right.
    expect(body()).toContain("rows.sorted { $0.day.serial < $1.day.serial }");
    // By `serial`, the calendar-free arithmetic the day ceiling is counted
    // with — not by a `Date`, which would need a zone to compare two days.
    expect(body()).not.toContain("$0.day.iso");
  });
});

describe("the live sample stream is named once and lives only in the foreground", () => {
  const bridge = () => read("ReactWatchHost/HealthQueryBridge.swift");
  const host = () => read("ReactWatchHost/ReactWatchHost.swift");
  const support = () => read("ReactWatchSupport/HealthQueryPlan.swift");
  /** The query builder's body: decl -> the next member. */
  const query = () => {
    const src = bridge();
    return src.slice(
      src.indexOf("private func startQuery(_ plan: HealthUpdatesPlan) {"),
      src.indexOf("func stopUpdates(_ plan: HealthUpdatesStopPlan) {"),
    );
  };
  /** Comments stripped — every rule below is NAMED in the prose explaining
   *  it, so a raw scan would match the documentation of a rule instead of a
   *  violation of it. */
  const code = () => bridge().replace(/^\s*\/\/.*$/gm, "");

  it("spells the event name in exactly one place, and JS agrees with it", () => {
    // THE typo gate. The event name is an unchecked STRING on both sides — a
    // Swift literal and a JS constant — and nothing compares them: a typo in
    // either yields a subscription that never fires, with no error anywhere to
    // say why. So there is one definition per side and this pins them equal.
    expect(support()).toContain(
      `public static let eventPrefix = "${HEALTH_UPDATE_EVENT_PREFIX}"`,
    );
    // ... and only one per side. The bridge asks the PLAN for the name
    // (`plan.eventName`) and the host forwards whatever it is handed, so a
    // second hand-written literal — the way the two halves would drift — fails
    // here rather than on a watch.
    const spelled = (src: string) =>
      src.split(`"${HEALTH_UPDATE_EVENT_PREFIX}`).length - 1;
    expect(spelled(support())).toBe(1);
    expect(spelled(code())).toBe(0);
    expect(spelled(host().replace(/^\s*\/\/.*$/gm, ""))).toBe(0);
    expect(query()).toContain("let event = plan.eventName");
    // Derived from the kind's raw value, so a fifteenth read type gets its
    // event name for free instead of needing a second table to forget.
    expect(support()).toContain("eventPrefix + kind.rawValue");
  });

  it("is a subscription on the INVOKE channel, not the reply-less sensor op", () => {
    // The start is FALLIBLE — no HealthKit, an unreadable type, an
    // authorization round trip — so it settles. `sensor` is the counter-example
    // and the reason: a fire-and-forget direct method with no reply path, where
    // a stream that never starts is a screen showing "—" and nothing in the log.
    for (const name of ["startHealthUpdates", "stopHealthUpdates"]) {
      const method = hostMethods.find((m) => m.name === name);
      expect(method?.via).toBe("invoke");
      expect(method?.feature).toBe("health");
      expect(method?.targets).toEqual(["watch"]);
      // No `response`: resolving IS the answer, and the samples arrive on the
      // event channel rather than as a return value.
      expect(method?.response).toBeUndefined();
    }
    // The STOP is the one health method not gated on `healthAvailable`: it runs
    // in an effect cleanup, where a rejection has no caller left and would
    // surface as an unhandled rejection on a routine unmount.
    const stop = host().slice(
      host().indexOf(
        "private func handleStopHealthUpdates(id: Int, payload: String) {",
      ),
      host().indexOf("private func settleHealth("),
    );
    expect(stop).not.toContain("healthAvailable");
    expect(stop).toContain("health.stopUpdates(plan)");
    // The START is gated, like every other health method.
    expect(
      host().slice(
        host().indexOf(
          "private func handleStartHealthUpdates(id: Int, payload: String) {",
        ),
        host().indexOf(
          "private func handleStopHealthUpdates(id: Int, payload: String) {",
        ),
      ),
    ).toContain("guard healthAvailable(id: id) else { return }");
  });

  it("delivers NEW samples only, with no cap that could end the stream", () => {
    // `anchor: nil` means "everything matching, then updates", so the PREDICATE
    // is what keeps the backlog out: samples still running or saved for an
    // interval reaching into now match, ones already over do not. A subscriber
    // that wants history has `queryHealthSamples`; replaying it here would hand
    // a screen a thousand-row first push on a device with a few MB of headroom.
    expect(query()).toContain("anchor: nil");
    expect(query()).toContain("withStart: Date(), end: nil");
    // No `limit`: Apple documents it as the maximum number of samples the QUERY
    // returns — a total, not a page — so a limit on a long-running stream would
    // end it silently after N samples, the one failure a live screen cannot see.
    expect(query()).toContain("limit: nil");
    // Sorted, because `addedSamples` carries no order promise and
    // `samples.at(-1)` is the newest value a heart-rate screen renders.
    expect(query()).toContain(".sorted { $0.startDate < $1.startDate }");
    // An update carrying neither new samples nor deletions is not pushed: an
    // empty batch would wake every subscriber and commit a render to say
    // nothing happened.
    expect(query()).toContain(
      "guard !rows.isEmpty || !deleted.isEmpty else { continue }",
    );
    // The descriptor family, not the callback class — whose cancellation and
    // off-main `updateHandler` this file would have to hand-roll around.
    expect(code()).toContain("HKAnchoredObjectQueryDescriptor(");
    expect(code()).not.toContain("HKAnchoredObjectQuery(");
  });

  it("emits a sample row with the SAME keys queryHealthSamples returns", () => {
    // The gap the ARCH-11 producer scan structurally cannot cover: that scan
    // reads invoke RESPONSES, and this payload rides the event channel, where
    // nothing decodes it strictly. A renamed key here degrades to `undefined`
    // on a watch with every other gate still green — so the row is pinned
    // against the schema's own `HealthSample` fields, in both directions.
    const declared = invokeShapes.find((shape) => shape.ts === "HealthSample");
    expect(declared).toBeDefined();
    const emitted = new Set(
      [...query().matchAll(/^\s*"(\w+)":/gm)].map((m) => m[1] as string),
    );
    expect([...emitted].sort()).toEqual(
      (declared?.fields ?? []).map((f) => f.name).sort(),
    );
    // And the unit is the READ table's, not a second spelling: a screen that
    // reads a total once and then streams must not have its numbers change
    // meaning halfway.
    expect(query()).toContain("let unit = Self.unit(for: kind)");
    expect(query()).toContain("let unitName = kind.unit");
    // The row keys are only half of it: the payload WRAPPER keys are the same
    // unchecked string pairs as the event name — Swift literals here,
    // `payload?.samples` / `payload?.deletedIds` reads in health.ts — and
    // renaming either Swift half would leave every gate green while the JS
    // narrowing fails on every push and the handler silently never fires.
    expect(host()).toContain(
      `payload: ["samples": samples, "deletedIds": deletedIds]`,
    );
    expect(healthTs()).toContain("const samples = payload?.samples;");
    expect(healthTs()).toContain("const deleted = payload?.deletedIds;");
  });

  it("reports deletions by the SAME identity both row producers emit", () => {
    // healthUpdateDeletions: a deletion is an id and nothing else, so it is
    // only actionable if the id names a row the subscriber has — which means
    // all three sites must read the same accessor. `HKObject.uuid` (watchOS
    // 2.0) on both row producers, `HKDeletedObject.uuid` (2.0) on the
    // retraction; a second spelling at any one of them is a deletion that
    // retracts nothing, silently.
    expect(query()).toContain(
      "let deleted = update.deletedObjects.map(\\.uuid.uuidString)",
    );
    expect(query()).toContain('"id": sample.uuid.uuidString');
    const samplesBody = code().slice(
      code().indexOf(
        "func samples(_ plan: HealthSamplesPlan) async -> Outcome {",
      ),
      code().indexOf("func sleepSamples("),
    );
    expect(samplesBody).toContain('"id": sample.uuid.uuidString');
    // Deletions ride the SAME buffer as additions — same floor, same merge —
    // so order survives coalescing: an add and its own deletion held into one
    // push net out to gone, where an immediate-deletions bypass could retract
    // a row whose add was still being held.
    expect(query()).toContain("buffer.deletedIds.append(contentsOf: deleted)");
    // ... and JS applies them in that order: samples to the handler first,
    // deletions to the per-subscriber callback second.
    const wrapper = healthTs().slice(
      healthTs().indexOf("const off = registerNativeListener("),
    );
    expect(wrapper.indexOf("const samples = payload?.samples;")).toBeLessThan(
      wrapper.indexOf("const deleted = payload?.deletedIds;"),
    );
  });

  it("coalesces by MERGING held batches, so none is dropped and none paces", () => {
    // Every push is a bridge crossing plus a synchronous React commit, so an
    // uncoalesced stream re-renders at sample rate — the cost `workout.metrics`
    // already coalesces against. Two differences, and the buffer serves both:
    // metrics are level state, so `emitMetricsIfDue` drops a too-early one and
    // loses nothing, while a sample stream is edge-triggered and a dropped batch
    // is data the caller can never get back; and N held batches merge into ONE
    // push, where sleeping between iterations would make them N pushes a floor
    // apart — the same render cost the knob was raised to avoid.
    expect(query()).toContain("let buffer = UpdateBuffer()");
    expect(query()).toContain("buffer.rows.append(contentsOf: rows)");
    expect(query()).toContain("buffer.take()");
    // The sleep is in the FLUSH, never in the `for try await` body: leaving a
    // batch unconsumed inside Apple's sequence would make the never-drop promise
    // HealthKit's to keep, and its buffering policy is documented nowhere.
    const loop = query().slice(
      query().indexOf("for try await update in descriptor.results(for: store)"),
      query().indexOf("buffer.flush = Task {"),
    );
    expect(loop).not.toContain("Task.sleep(");
    // A cancelled task still stops draining the sequence when the floor is 0
    // (legal, and it means "every batch, as it lands"), where nothing else in
    // the loop body suspends.
    expect(loop).toContain("try Task.checkCancellation()");
    // The emit guard is this task's OWN identity. `wantedUpdates` cannot answer
    // it: a background pause deliberately keeps that entry, so an in-flight
    // batch would push into an app nobody can see, and a stop-then-restart would
    // make it push alongside the new stream. The epoch moves on every stop,
    // pause, teardown and supersession, so it covers all of them without relying
    // on Apple observing cancellation promptly.
    expect(query()).not.toContain("self.wantedUpdates[kind] != nil");
    expect(
      query().split("guard let self, self.updateEpochs[kind] == epoch else")
        .length - 1,
    ).toBe(3);
    // Which is only true if the pause moves the epoch too — the one supersession
    // path that leaves `wantedUpdates` intact by design.
    const pause = code().slice(
      code().indexOf("func pauseUpdatesForBackground() {"),
      code().indexOf("func resumeUpdatesFromForeground() {"),
    );
    expect(pause).toContain(
      "updateEpochs[kind] = (updateEpochs[kind] ?? 0) + 1",
    );
  });

  it("stops every stream on teardown, before the runtime is freed", () => {
    // The push path is name-routed with NO generation guard, so a query that
    // outlived `tearDownGeneration()` would deliver `health.samples.*` into the
    // runtime `boot()` is about to install — one that never subscribed.
    // `sensors.stopAll()`'s reason, for the one stream that is not a sensor.
    const teardown = host().slice(
      host().indexOf("private func tearDownGeneration() {"),
      host().indexOf(
        "private func installFreshRuntime() throws -> JSRuntime {",
      ),
    );
    expect(teardown).toContain("health.stopAllUpdates()");
    expect(teardown.indexOf("health.stopAllUpdates()")).toBeLessThan(
      teardown.indexOf("runtime?.shutdown()"),
    );
  });

  it("is foreground-only: paused on background, re-armed on active", () => {
    // A backgrounded app is not unmounted, so JS effect cleanups never fire and
    // native owns the policy (the P0-3 rule the heart-rate pump lives by). And
    // this package ships no background-delivery entitlement, so an armed query
    // would deliver nothing while the app is away and wake it for nothing when
    // it returned.
    const scene = host().slice(
      host().indexOf("func handleScenePhase(background: Bool) {"),
    );
    const active = scene.indexOf("} else {");
    expect(scene.indexOf("health.pauseUpdatesForBackground()")).toBeLessThan(
      active,
    );
    expect(
      scene.indexOf("health.resumeUpdatesFromForeground()"),
    ).toBeGreaterThan(active);
    // The DESIRED state survives the pause — that is what makes the resume a
    // restart rather than a guess — while the task handles do not.
    const pause = code().slice(
      code().indexOf("func pauseUpdatesForBackground() {"),
      code().indexOf("func resumeUpdatesFromForeground() {"),
    );
    expect(pause).toContain("updateTasks.removeAll()");
    expect(pause).not.toContain("wantedUpdates.removeAll()");
    // No background delivery is requested anywhere: Apple gates that behind an
    // entitlement this package does not ship, and asking for it without one is
    // how the feature would fail at runtime instead of at review.
    expect(code()).not.toContain("enableBackgroundDelivery");
    expect(host()).not.toContain("enableBackgroundDelivery");
  });

  it("cannot arm an orphan query out of the authorization window", () => {
    // The window is real: the sheet is a suspension, and a stop — or React
    // StrictMode's stop-then-restart — lands inside it. Without the epoch the
    // superseded start would resume, see the SECOND start's `wantedUpdates`
    // entry, and arm a second query whose handle is immediately overwritten: an
    // orphan pushing duplicate samples with nothing left to cancel it.
    const begin = code().slice(
      code().indexOf("func beginUpdates(_ plan: HealthUpdatesPlan) -> Int? {"),
      code().indexOf(
        "func finishUpdates(_ plan: HealthUpdatesPlan, epoch: Int) async",
      ),
    );
    const start = code().slice(
      code().indexOf(
        "func finishUpdates(_ plan: HealthUpdatesPlan, epoch: Int) async",
      ),
      code().indexOf("private func startQuery(_ plan: HealthUpdatesPlan) {"),
    );
    expect(start).toContain("guard updateEpochs[kind] == epoch else");
    expect(start).toContain("guard !isBackgrounded else");
    // The epoch and the desired state are CLAIMED synchronously, and the claim
    // is a true no-op for a type already streaming. Both halves matter: bumping
    // the epoch past a running task's would break the self-heal below (its tail
    // would never clear a finished handle, and nothing could re-arm), and
    // re-latching `wantedUpdates` would silently re-arm the next foreground at
    // the SECOND subscriber's interval — contradicting the first-subscriber-wins
    // rule `HealthUpdateOptions` documents.
    expect(begin.indexOf("guard updateTasks[kind] == nil else")).toBeLessThan(
      begin.indexOf("updateEpochs[kind] = epoch"),
    );
    expect(begin.indexOf("updateEpochs[kind] = epoch")).toBeLessThan(
      begin.indexOf("wantedUpdates[kind] = plan"),
    );
    // ... and the async half claims NOTHING, or a stop that ran while the
    // authorization sheet was up would have nothing to supersede.
    expect(start).not.toContain("wantedUpdates[kind] = plan");
    // The host claims BEFORE it hops. `invoke` is a synchronous QuickJS
    // callback and the matching stop is synchronous, so a start whose state
    // landed only inside its `Task` would be invisible to a stop — or to
    // `tearDownGeneration()` — issued in the same JS turn, and would then arm a
    // query with no subscriber left and nothing able to cancel it.
    const handler = host().slice(
      host().indexOf(
        "private func handleStartHealthUpdates(id: Int, payload: String) {",
      ),
      host().indexOf(
        "private func handleStopHealthUpdates(id: Int, payload: String) {",
      ),
    );
    expect(handler).toContain("guard let epoch = health.beginUpdates(plan)");
    expect(handler.indexOf("health.beginUpdates(plan)")).toBeLessThan(
      handler.indexOf("Task {"),
    );
    expect(handler).toContain("bridge.finishUpdates(plan, epoch: epoch)");
    // The epoch moves on a STOP too, or a start still inside the window would
    // resume and arm the stream the stop just took down.
    expect(code()).toContain(
      "updateEpochs[kind] = (updateEpochs[kind] ?? 0) + 1",
    );
    // One task per type, always, and the resume bumps the epoch too — so a
    // start still inside its window is superseded by a foreground resume
    // rather than racing it.
    expect(query()).toContain("guard updateTasks[kind] == nil else { return }");
    expect(query()).toContain("let epoch = (updateEpochs[kind] ?? 0) + 1");
    // A stream HealthKit ends on its own clears its handle, so `wanted` with no
    // task is what the next foreground re-arms — the `sensor.heartRate`
    // recovery rule. Epoch-guarded, or a task cancelled to make room for a
    // newer one would clear the newer one's handle on the way out.
    expect(query()).toContain(
      "guard let self, self.updateEpochs[kind] == epoch else { return }",
    );
  });

  it("touches its main-confined state only from the main actor", () => {
    // HealthKit produces these elements on its own queue. The whole bridge is
    // `@MainActor`, so the query's `Task` inherits that isolation and every
    // `await` resumes on main — which is why this file needs none of
    // WorkoutBridge's `nonisolated(unsafe)` hops, and why the AsyncSequence was
    // chosen over `HKAnchoredObjectQuery`'s off-main `updateHandler`.
    expect(bridge()).toContain("@MainActor final class HealthQueryBridge {");
    expect(code()).not.toContain("nonisolated(unsafe)");
    expect(code()).not.toContain("DispatchQueue.main.async");
  });
});

describe("the new features are watch-only", () => {
  it("no health / workouts method reaches the widget runtime", () => {
    // Not a special case — a consequence. `HostInvokeFeatures.byMethod` is
    // built from ALL invoke methods, and WidgetIntentRuntime's typed rejecter
    // answers UNAVAILABLE for any whose feature isn't in HostFeatures.widget.
    // Substantively right too: the widget's contract is decode-and-display,
    // async HealthKit I/O inside getTimeline is metered against the WidgetKit
    // refresh budget, and an HKWorkoutSession in an extension is a non-starter.
    const widgetExposed = hostMethods.filter(
      (m) =>
        m.targets.includes("widget") &&
        (m.feature === "health" || m.feature === "workouts"),
    );
    expect(widgetExposed).toEqual([]);
    expect(HOST_FEATURES.widget).not.toContain("health");
    expect(HOST_FEATURES.widget).not.toContain("workouts");
    expect(HOST_FEATURES.watch).toContain("health");
    expect(HOST_FEATURES.watch).toContain("workouts");
  });

  it("pedometer rides `sensors` rather than inventing a feature", () => {
    // CMPedometer is CoreMotion: same framework, same usage description, same
    // single OS consent toggle as the shipped motion streams. A feature id that
    // maps to no independently-grantable consent would make the feature list
    // lie about what a denial achieves.
    const pedometer = hostMethods.find((m) => m.name === "queryPedometer");
    expect(pedometer?.feature).toBe("sensors");
  });
});
