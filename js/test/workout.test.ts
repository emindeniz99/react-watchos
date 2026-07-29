import { afterEach, describe, expect, it } from "vitest";
import {
  endWorkout,
  getWorkoutState,
  onWorkoutMetrics,
  onWorkoutState,
  pauseWorkout,
  resumeWorkout,
  startWorkout,
  WORKOUT_METRICS_EVENT,
  WORKOUT_STATE_EVENT,
} from "../src/index";
import {
  dispatchNativeEvent,
  unregisterAllNativeListeners,
} from "../src/nativeEvents";

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  delete g.__host;
  delete g.__resolveInvoke;
  delete g.__rejectInvoke;
  unregisterAllNativeListeners();
});

/** Records every invoke and settles it with `result`. */
function installHost(result: unknown = null) {
  const calls: { method: string; payload: unknown }[] = [];
  const g = globalThis as Record<string, unknown>;
  g.__host = {
    invoke: (id: number, method: string, payloadJson: string) => {
      calls.push({
        method,
        payload: payloadJson ? JSON.parse(payloadJson) : undefined,
      });
      (g.__resolveInvoke as (i: number, j: string) => void)(
        id,
        JSON.stringify(result),
      );
    },
  };
  return calls;
}

describe("workout control", () => {
  it("sends only the options the caller set", () => {
    // Every omitted option is a native default the schema documents; sending
    // `undefined` for it would put an undeclared key on the wire, which the
    // ARCH-11 strict decoder rejects.
    const calls = installHost();
    startWorkout("running");
    startWorkout("cycling", {
      location: "outdoor",
      metricsIntervalMs: 5000,
      collectRoute: true,
    });
    expect(calls.map((c) => c.payload)).toEqual([
      { activityType: "running" },
      {
        activityType: "cycling",
        location: "outdoor",
        metricsIntervalMs: 5000,
        collectRoute: true,
      },
    ]);
  });

  it("always states the save/discard choice explicitly", () => {
    // Apple's HIG requires an app to either save automatically or offer an
    // explicit save/discard choice. Defaulting the field rather than omitting
    // it means the native side never has to guess which the caller meant.
    const calls = installHost({ state: "ended", elapsedMs: 0 });
    endWorkout();
    endWorkout({ discard: true });
    expect(calls.map((c) => c.payload)).toEqual([
      { discard: false },
      { discard: true },
    ]);
  });

  it("resolves the ended snapshot from endWorkout, not just void", () => {
    // The saved id/duration/energy/distance arrive with the end, so a summary
    // screen needs no second round trip.
    installHost({
      state: "ended",
      elapsedMs: 1000,
      endedReason: "requested",
      endedDurationMs: 1000,
      endedWorkoutId: "abc",
    });
    return expect(endWorkout()).resolves.toMatchObject({
      endedWorkoutId: "abc",
      endedReason: "requested",
    });
  });

  it("reports a workout ended by a runtime reload through getWorkoutState", async () => {
    // The v1 answer to "a workout does not survive a reload": native ends AND
    // saves it, then parks the summary — pushing an event into a dying context
    // would reach nobody, so the fresh runtime pulls it.
    installHost({
      state: "ended",
      elapsedMs: 0,
      endedReason: "runtimeReload",
      endedDurationMs: 600_000,
      endedWorkoutId: "saved-by-teardown",
    });
    const state = await getWorkoutState();
    expect(state.endedReason).toBe("runtimeReload");
    expect(state.endedWorkoutId).toBe("saved-by-teardown");
  });

  it("routes pause/resume as their own methods with no payload", () => {
    const calls = installHost();
    pauseWorkout();
    resumeWorkout();
    expect(calls).toEqual([
      { method: "pauseWorkout", payload: undefined },
      { method: "resumeWorkout", payload: undefined },
    ]);
  });

  it("delivers state + metrics on the push channel", () => {
    const states: unknown[] = [];
    const metrics: unknown[] = [];
    onWorkoutState((p) => states.push(p));
    onWorkoutMetrics((p) => metrics.push(p));
    dispatchNativeEvent(WORKOUT_STATE_EVENT, { state: "running" });
    dispatchNativeEvent(WORKOUT_METRICS_EVENT, {
      elapsedMs: 60_000,
      heartRateBpm: 142,
    });
    expect(states).toEqual([{ state: "running" }]);
    expect(metrics).toEqual([{ elapsedMs: 60_000, heartRateBpm: 142 }]);
  });

  it("rejects UNAVAILABLE with no invoke-capable host (tests / widget)", async () => {
    await expect(startWorkout("running")).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
  });
});

// Compile-time guard (never executed): `WorkoutActivityType` is the closed set
// of live HKWorkoutActivityType cases, generated from the same schema list that
// renders the Swift name→case switch. An open string would let a typo reach a
// switch whose only honest answer is "unknown activityType". `export`ed so
// `noUnusedLocals` doesn't flag a guard that must never be CALLED.
export function _unknownActivityTypeIsATypeError() {
  // @ts-expect-error "jogging" is not an HKWorkoutActivityType case
  startWorkout("jogging");
  // @ts-expect-error `dance` is deprecated and deliberately excluded
  startWorkout("dance");
}
