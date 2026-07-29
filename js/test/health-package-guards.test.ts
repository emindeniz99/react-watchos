import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hostMethods } from "../codegen/schema";
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

  it("teardown ends the workout before the runtime is freed (ARCH-08)", () => {
    // Ordering is the point: the session must be released before QuickJS goes
    // away, and after the sensor claim is dropped, so the fresh runtime cannot
    // inherit a workout it never started.
    const src = read("ReactWatchHost/ReactWatchHost.swift");
    const teardown = src.slice(
      src.indexOf("private func tearDownGeneration() {"),
    );
    const sensors = teardown.indexOf("sensors.stopAll()");
    const workout = teardown.indexOf("workout.tearDownForReload()");
    const shutdown = teardown.indexOf("runtime?.shutdown()");
    expect(sensors).toBeGreaterThan(-1);
    expect(workout).toBeGreaterThan(sensors);
    expect(shutdown).toBeGreaterThan(workout);
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
