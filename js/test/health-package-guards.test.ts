import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { healthQuantityTypes, hostMethods } from "../codegen/schema";
import { HOST_FEATURES } from "../src/generated/wire";
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

describe("the daily statistics collection is contiguous, not sparse", () => {
  it("enumerates every interval instead of only the ones with samples", () => {
    // `HKStatisticsCollection.statistics()` skips intervals with no samples
    // ("there may be arbitrarily large gaps"), so a week the user rested twice
    // would come back as five buckets and every caller would re-derive which
    // days were missing. `enumerateStatistics(from:to:)` calls the block once
    // per interval with a nil-valued quantity, which is exactly the
    // `value: null` the scalar query already means. That is the difference
    // between "results.length is the number of days you asked for" and not.
    const src = read("ReactWatchHost/HealthQueryBridge.swift");
    const body = src.slice(
      src.indexOf(
        "func dailyStatistics(_ plan: HealthStatisticsPlan) async -> Outcome {",
      ),
    );
    expect(body).toContain("collection.enumerateStatistics(");
    expect(body).not.toContain("collection.statistics()");
    // Day granularity, anchored on the caller's own window start — that is
    // what keeps the time zone in JS, where the calendar actually is.
    expect(body).toContain("anchorDate: plan.window.start");
    expect(body).toContain("intervalComponents: DateComponents(day: 1)");
    // The off-by-one Apple's contract introduces (the final interval is the
    // one CONTAINING the end date) is dropped by the Linux-tested rule, not
    // re-derived here.
    expect(body).toContain("window.containsBucketStart(startMs)");
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
