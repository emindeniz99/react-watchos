import { afterEach, describe, expect, it } from "vitest";
import {
  queryHealthDailyStatistics,
  queryHealthSamples,
  queryHealthStatistics,
  querySleepSamples,
  queryWorkoutHistory,
  requestHealthAuthorization,
} from "../src/index";

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  delete g.__host;
  delete g.__resolveInvoke;
  delete g.__rejectInvoke;
});

/** A host that records every invoke and settles it with `result`. */
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

describe("health reads", () => {
  it("sends the whole window verbatim — no unit, ever", () => {
    // The unit is chosen NATIVELY and only reported back. A unit on the request
    // would be a drift surface with no gate: JS could ask for miles while the
    // Swift table reads meters and nothing would fail until a chart lied.
    const calls = installHost({
      value: 8412,
      unit: "count",
      startMs: 1,
      endMs: 2,
    });
    queryHealthStatistics({
      type: "stepCount",
      statistic: "sum",
      startMs: 1,
      endMs: 2,
    });
    expect(calls).toEqual([
      {
        method: "queryHealthStatistics",
        payload: { type: "stepCount", statistic: "sum", startMs: 1, endMs: 2 },
      },
    ]);
  });

  it("resolves value: null as the honest 'nothing to report'", async () => {
    // null is NOT distinguishable from a denied read — Apple does not tell an
    // app whether a read was granted. The type says `number | null` precisely
    // so a caller has to handle it rather than render NaN.
    installHost({ value: null, unit: "kcal", startMs: 1, endMs: 2 });
    const result = await queryHealthStatistics({
      type: "activeEnergyBurned",
      statistic: "sum",
      startMs: 1,
      endMs: 2,
    });
    expect(result.value).toBeNull();
    expect(result.unit).toBe("kcal");
  });

  it("asks for a week of buckets with ONE invoke, not seven", () => {
    // The whole reason this method exists: the same chart used to cost seven
    // queryHealthStatistics round trips, and seven HealthKit queries on a watch
    // is a battery cost. The payload must stay the scalar query's payload —
    // a bucket IS that aggregate over one day — so a private request shape
    // here would be the drift this asserts against.
    const day = 86_400_000;
    const calls = installHost([]);
    queryHealthDailyStatistics({
      type: "stepCount",
      statistic: "sum",
      startMs: day,
      endMs: 8 * day,
    });
    expect(calls).toEqual([
      {
        method: "queryHealthDailyStatistics",
        payload: {
          type: "stepCount",
          statistic: "sum",
          startMs: day,
          endMs: 8 * day,
        },
      },
    ]);
  });

  it("keeps an empty day as a null bucket rather than a gap", async () => {
    // Contiguity is the contract: `enumerateStatistics` fills an empty interval
    // with a nil quantity, so index n is day n and `.length` is the number of
    // days asked for. `statistics()` would have skipped the rest day and made
    // every caller re-derive which one it was.
    const day = 86_400_000;
    installHost([
      { value: 8412, unit: "count", startMs: 0, endMs: day },
      { value: null, unit: "count", startMs: day, endMs: 2 * day },
    ]);
    const buckets = await queryHealthDailyStatistics({
      type: "stepCount",
      statistic: "sum",
      startMs: 0,
      endMs: 2 * day,
    });
    expect(buckets).toHaveLength(2);
    expect(buckets[1]?.value).toBeNull();
    expect(buckets[1]?.startMs).toBe(day);
  });

  it("omits limit when the caller didn't set one", () => {
    const calls = installHost([]);
    queryHealthSamples({ type: "heartRate", startMs: 1, endMs: 2 });
    querySleepSamples({ startMs: 3, endMs: 4 });
    expect(calls.map((c) => c.payload)).toEqual([
      { type: "heartRate", startMs: 1, endMs: 2 },
      { startMs: 3, endMs: 4 },
    ]);
  });

  it("forwards sleep only when asked, so a read-only ask stays read-only", () => {
    // sleepAnalysis is a CATEGORY type: asking for it widens the permission
    // sheet, so it must never ride along by default.
    const calls = installHost("prompted");
    requestHealthAuthorization({ read: ["stepCount"] });
    requestHealthAuthorization({ read: ["stepCount"], sleep: true });
    expect(calls.map((c) => c.payload)).toEqual([
      { read: ["stepCount"] },
      { read: ["stepCount"], sleep: true },
    ]);
  });

  it("asks for the saved-workout read only when the caller opts in", () => {
    // Saved workouts are their own HealthKit object type, so asking for them
    // adds a ROW to the permission sheet — the same reason `sleep` never rides
    // along by default. And the flag is about READING history: it must not
    // appear because an app happens to record workouts.
    const calls = installHost("prompted");
    requestHealthAuthorization({ read: ["stepCount"] });
    requestHealthAuthorization({ read: [], workoutHistory: true });
    expect(calls.map((c) => c.payload)).toEqual([
      { read: ["stepCount"] },
      { read: [], workoutHistory: true },
    ]);
  });

  it("lists saved workouts and keeps 'not measured' as null, not 0", async () => {
    // The window rides verbatim like every other read, and the response is
    // returned as-is: a yoga session with no distance samples resolves
    // `distanceMeters: null`, which a screen renders as "—" rather than as
    // "0.00 km". Flattening that to 0 would invent a measurement.
    const calls = installHost([
      {
        id: "6C7F1B0E-6C3E-4B0A-9F1D-2A9E4F1B7C10",
        startMs: 1_768_460_400_000,
        endMs: 1_768_462_245_000,
        durationMs: 1_800_000,
        activityType: "running",
        activeEnergyKcal: 312.5,
        distanceMeters: 5_412.75,
      },
      {
        id: "9B1DEB4D-3B7D-4BAD-9BDD-2B0D7B3DCB6D",
        startMs: 1_768_390_000_000,
        endMs: 1_768_392_700_000,
        durationMs: 2_700_000,
        activeEnergyKcal: null,
        distanceMeters: null,
      },
    ]);
    const listed = queryWorkoutHistory({
      startMs: 1_768_396_800_000,
      endMs: 1_768_483_200_000,
      limit: 20,
    });
    expect(calls).toEqual([
      {
        method: "queryWorkoutHistory",
        payload: {
          startMs: 1_768_396_800_000,
          endMs: 1_768_483_200_000,
          limit: 20,
        },
      },
    ]);
    const workouts = await listed;
    expect(workouts).toHaveLength(2);
    const [run, unnamed] = workouts;
    // durationMs is HealthKit's own `duration`, which excludes paused time —
    // so it is NOT endMs - startMs (1_845_000 here) and a caller that
    // recomputed it would report the wrong number for any paused workout.
    expect(run?.durationMs).toBe(1_800_000);
    expect((run?.endMs ?? 0) - (run?.startMs ?? 0)).toBe(1_845_000);
    // An activity this binary has no name for is OMITTED, never guessed.
    expect(unnamed?.activityType).toBeUndefined();
    expect(unnamed?.distanceMeters).toBeNull();
    expect(unnamed?.activeEnergyKcal).toBeNull();
  });

  it("resolves the authorization signal verbatim, not a grant verdict", async () => {
    installHost("alreadyRequested");
    expect(await requestHealthAuthorization({ read: ["heartRate"] })).toBe(
      "alreadyRequested",
    );
  });

  it("reports each new type in its own native unit, unasked", async () => {
    // The two types added together are the case where a caller-chosen unit
    // would have to lie: SDNN is milliseconds and resting heart rate is bpm,
    // so neither request carries a unit and each response names its own. (The
    // per-type unit TABLE itself is Swift — `HealthQueryPlanTests` pins it.)
    const hrvCalls = installHost({
      value: 45,
      unit: "ms",
      startMs: 1,
      endMs: 2,
    });
    const hrv = await queryHealthStatistics({
      type: "heartRateVariabilitySDNN",
      statistic: "average",
      startMs: 1,
      endMs: 2,
    });
    // 45, not 0.045 — the whole reason the native side reads SDNN in
    // milliseconds instead of seconds.
    expect(hrv.value).toBe(45);
    expect(hrv.unit).toBe("ms");
    const restingCalls = installHost({
      value: 58,
      unit: "count/min",
      startMs: 1,
      endMs: 2,
    });
    const resting = await queryHealthStatistics({
      type: "restingHeartRate",
      statistic: "average",
      startMs: 1,
      endMs: 2,
    });
    expect(resting.value).toBe(58);
    expect(resting.unit).toBe("count/min");
    expect([...hrvCalls, ...restingCalls].map((c) => c.payload)).toEqual([
      {
        type: "heartRateVariabilitySDNN",
        statistic: "average",
        startMs: 1,
        endMs: 2,
      },
      {
        type: "restingHeartRate",
        statistic: "average",
        startMs: 1,
        endMs: 2,
      },
    ]);
  });

  it("surfaces the native refusal of a sum over a discrete type", async () => {
    // Both new types are DISCRETE, so `sum` is the one statistic HealthKit
    // would THROW on. The rule is decided natively (HealthQueryPlan) and this
    // asserts the reason reaches the caller instead of being flattened into a
    // bare failure — a caller cannot read Apple's statistics matrix otherwise.
    const g = globalThis as Record<string, unknown>;
    g.__host = {
      invoke: (id: number) => {
        (g.__rejectInvoke as (i: number, j: string) => void)(
          id,
          JSON.stringify({
            code: "INVALID_REQUEST",
            message:
              "statistic 'sum' is not valid for 'heartRateVariabilitySDNN'",
          }),
        );
      },
    };
    await expect(
      queryHealthStatistics({
        type: "heartRateVariabilitySDNN",
        statistic: "sum",
        startMs: 1,
        endMs: 2,
      }),
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      // The REASON, not just the code: a caller cannot read Apple's statistics
      // matrix, so flattening this to a bare failure is the regression.
      message: expect.stringContaining("not valid for"),
    });
  });

  it("rejects UNAVAILABLE with no invoke-capable host (tests / widget)", async () => {
    await expect(
      querySleepSamples({ startMs: 1, endMs: 2 }),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
});

// Compile-time guards (never executed): the two closed vocabularies. An open
// string would let `queryHealthStatistics({ type: "steps" })` type-check,
// return a plausible promise, and resolve `null` forever — the same skipped
// feature at the type level that `2fd7739` removed from SensorKind. If either
// union is re-widened, the @ts-expect-error goes unused and typecheck fails.
//
// `export`ed only so `noUnusedLocals` doesn't flag them: they must never be
// CALLED (the calls inside are deliberately ill-typed).
export function _unknownHealthTypeIsATypeError() {
  // @ts-expect-error "steps" is not a bound HealthKit quantity type
  queryHealthSamples({ type: "steps", startMs: 1, endMs: 2 });
}

export function _illegalStatisticNameIsATypeError() {
  queryHealthStatistics({
    type: "stepCount",
    // @ts-expect-error "median" is not one of the five mapped statistics
    statistic: "median",
    startMs: 1,
    endMs: 2,
  });
}
