import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetHealthUpdatesForTest, startHealthUpdates } from "../src/health";
import {
  HEALTH_UPDATE_EVENT_PREFIX,
  queryActivitySummaries,
  queryHealthDailyStatistics,
  queryHealthHourlyStatistics,
  queryHealthSamples,
  queryHealthStatistics,
  querySleepSamples,
  queryWorkoutHistory,
  requestHealthAuthorization,
} from "../src/index";
import { dispatchNativeEvent } from "../src/nativeEvents";

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  delete g.__host;
  delete g.__resolveInvoke;
  delete g.__rejectInvoke;
  // The live-updates refcount is module state: a test that leaves a token
  // behind would make the NEXT test's first subscriber skip its start invoke
  // and listen to a stream nobody armed.
  __resetHealthUpdatesForTest();
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

  it("asks for a day of hourly buckets with ONE invoke, and the same payload", () => {
    // The hourly sibling of the daily query: same request shape, same result
    // rows, a different stride named by the METHOD — so the payload must stay
    // the scalar query's payload, with no bucket-size knob smuggled in.
    const hour = 3_600_000;
    const calls = installHost([]);
    queryHealthHourlyStatistics({
      type: "stepCount",
      statistic: "sum",
      startMs: 0,
      endMs: 24 * hour,
    });
    expect(calls).toEqual([
      {
        method: "queryHealthHourlyStatistics",
        payload: {
          type: "stepCount",
          statistic: "sum",
          startMs: 0,
          endMs: 24 * hour,
        },
      },
    ]);
  });

  it("keeps an empty hour as a null bucket rather than a gap", async () => {
    // Contiguity is the same contract as the daily buckets: index n is hour n
    // and `.length` is the number of hours asked for — which is what lets a
    // steps-per-hour chart label bars off `startMs` without re-deriving gaps.
    const hour = 3_600_000;
    installHost([
      { value: 612, unit: "count", startMs: 0, endMs: hour },
      { value: null, unit: "count", startMs: hour, endMs: 2 * hour },
    ]);
    const buckets = await queryHealthHourlyStatistics({
      type: "stepCount",
      statistic: "sum",
      startMs: 0,
      endMs: 2 * hour,
    });
    expect(buckets).toHaveLength(2);
    expect(buckets[1]?.value).toBeNull();
    expect(buckets[1]?.startMs).toBe(hour);
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

  it("asks for the rings only when the caller opts in", () => {
    // A third sheet ROW, like sleep and saved workouts — so it can never
    // default on. And it is not implied by the quantity reads that look
    // related: `appleExerciseTime` is a different HealthKit type from the
    // summary that knows what that day's exercise GOAL was.
    const calls = installHost("prompted");
    requestHealthAuthorization({ read: ["appleExerciseTime"] });
    requestHealthAuthorization({ read: [], activitySummaries: true });
    expect(calls.map((c) => c.payload)).toEqual([
      { read: ["appleExerciseTime"] },
      { read: [], activitySummaries: true },
    ]);
  });

  it("asks for rings by DAY and keeps a missing goal as null", async () => {
    // Two things this pins that nothing else can. First the request: days
    // ride verbatim as "YYYY-MM-DD" — no Date, no epoch, nothing that could
    // pick up the runner's time zone and ask for yesterday's rings.
    const calls = installHost([
      {
        date: "2026-01-14",
        moveMode: "activeEnergy",
        activeEnergyKcal: 412.5,
        activeEnergyGoalKcal: 500,
        moveTimeMinutes: 0,
        moveTimeGoalMinutes: 30,
        exerciseMinutes: 23,
        exerciseGoalMinutes: 30,
        standHours: 10,
        standHoursGoal: 12,
      },
      {
        date: "2026-01-16",
        moveMode: "appleMoveTime",
        activeEnergyKcal: 180,
        activeEnergyGoalKcal: 350,
        moveTimeMinutes: 47,
        moveTimeGoalMinutes: 60,
        exerciseMinutes: 12,
        exerciseGoalMinutes: null,
        standHours: 7,
        standHoursGoal: null,
      },
    ]);
    const asked = queryActivitySummaries({
      startDate: "2026-01-14",
      endDate: "2026-01-20",
    });
    expect(calls).toEqual([
      {
        method: "queryActivitySummaries",
        payload: { startDate: "2026-01-14", endDate: "2026-01-20" },
      },
    ]);
    const days = await asked;
    // Second: a SEVEN-day ask can resolve two rows. HealthKit has no summary
    // for a day the watch was off, so the answer is not a dense series and the
    // caller must read `date`, never the index — the 15th is simply absent.
    expect(days.map((d) => d.date)).toEqual(["2026-01-14", "2026-01-16"]);
    // The ring pair to draw depends on the mode: this day was scored on
    // MINUTES, so 180 of 350 kcal is not the ring that user closed.
    expect(days[1]?.moveMode).toBe("appleMoveTime");
    expect(days[1]?.moveTimeMinutes).toBe(47);
    // A goal HealthKit does not have stays null — never Apple's default 30,
    // which would draw a ring the user was never scored against.
    expect(days[1]?.exerciseGoalMinutes).toBeNull();
    expect(days[1]?.standHoursGoal).toBeNull();
    expect(days[0]?.exerciseGoalMinutes).toBe(30);
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

describe("live health updates", () => {
  /** One sample row, the shape `queryHealthSamples` returns verbatim — id
   *  included, since the row's identity is what a deletion retracts by. */
  const sample = (value: number, startMs: number) => ({
    id: `id-${startMs}`,
    startMs,
    endMs: startMs + 1000,
    value,
    unit: "count/min",
  });

  it("arms one query, routes its samples, and stops on the last unsubscribe", () => {
    const calls = installHost(null);
    const seen: unknown[] = [];
    const live = startHealthUpdates("heartRate", (update) => seen.push(update));
    // The START is an invoke, not the fire-and-forget `sensor` op: it can fail
    // (no HealthKit, an unreadable type) and the failure has to settle
    // somewhere. `minIntervalMs` is absent because the caller omitted it —
    // native owns the default rather than JS restating it.
    expect(calls).toEqual([
      { method: "startHealthUpdates", payload: { type: "heartRate" } },
    ]);

    dispatchNativeEvent(`${HEALTH_UPDATE_EVENT_PREFIX}heartRate`, {
      samples: [sample(61, 1_768_396_800_000), sample(64, 1_768_396_801_000)],
    });
    // NARROWED in the wrapper: a handler is handed a typed `HealthUpdate` with
    // the type it subscribed to, never the channel's raw record.
    expect(seen).toEqual([
      {
        type: "heartRate",
        samples: [sample(61, 1_768_396_800_000), sample(64, 1_768_396_801_000)],
        // The newest row, computed where non-emptiness was just proved — so the
        // "current heart rate" screen this API exists for reads `u.latest.value`
        // instead of an index `noUncheckedIndexedAccess` widens to `undefined`
        // or an `.at(-1)` this package's ES2020 target does not have.
        latest: sample(64, 1_768_396_801_000),
      },
    ]);

    live.stop();
    expect(calls[1]).toEqual({
      method: "stopHealthUpdates",
      payload: { type: "heartRate" },
    });
    dispatchNativeEvent(`${HEALTH_UPDATE_EVENT_PREFIX}heartRate`, {
      samples: [sample(70, 1_768_396_802_000)],
    });
    expect(seen).toHaveLength(1);
    // Idempotent: React StrictMode runs a cleanup twice, and a second stop
    // invoke would take down a stream a remount had already restarted.
    live.stop();
    expect(calls).toHaveLength(2);
  });

  it("shares one native query and fires each subscriber exactly once", () => {
    const calls = installHost(null);
    // The SAME function for both, which is the case `registerNativeListener`
    // keys on a fresh entry for: a `Set<handler>` would collapse these into one
    // member, and the first unsubscribe would silence the second subscription
    // while its caller still believed it was listening.
    let fired = 0;
    const shared = () => {
      fired += 1;
    };
    const first = startHealthUpdates("stepCount", shared, {
      minIntervalMs: 2000,
    });
    const second = startHealthUpdates("stepCount", shared, {
      minIntervalMs: 50,
    });
    // ONE start, and the FIRST subscriber's options win — the native query is
    // shared, so the second's 50ms cannot re-tune it (the `startSensor` rule).
    expect(calls).toEqual([
      {
        method: "startHealthUpdates",
        payload: { type: "stepCount", minIntervalMs: 2000 },
      },
    ]);
    // Both subscribers get the same settlement: the second must not believe a
    // stream is live that the first failed to arm.
    expect(second.started).toBe(first.started);

    dispatchNativeEvent(`${HEALTH_UPDATE_EVENT_PREFIX}stepCount`, {
      samples: [{ startMs: 1, endMs: 2, value: 12, unit: "count" }],
    });
    expect(fired).toBe(2);

    // The stream outlives the first unsubscribe — one subscriber is still
    // watching, so no stop crosses the bridge.
    first.stop();
    expect(calls).toHaveLength(1);
    dispatchNativeEvent(`${HEALTH_UPDATE_EVENT_PREFIX}stepCount`, {
      samples: [{ startMs: 3, endMs: 4, value: 3, unit: "count" }],
    });
    expect(fired).toBe(3);

    second.stop();
    expect(calls[1]?.method).toBe("stopHealthUpdates");
  });

  it("rejects a failed start and lets the next subscriber retry", async () => {
    const g = globalThis as Record<string, unknown>;
    const rejected: string[] = [];
    g.__host = {
      invoke: (id: number, method: string) => {
        rejected.push(method);
        (g.__rejectInvoke as (i: number, j: string) => void)(
          id,
          JSON.stringify({
            code: "UNAVAILABLE",
            message: "HealthKit is not available on this device",
          }),
        );
      },
    };
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const live = startHealthUpdates("vo2Max", () => {});
    // The whole reason the start rides `invoke`: a stream that could not be
    // armed says so, instead of leaving a screen on "—" forever the way the
    // reply-less `sensor` op would.
    await expect(live.started).rejects.toMatchObject({ code: "UNAVAILABLE" });
    // ... and it is loud even for a caller who never awaits `started`.
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();

    // A failed start left NO query behind, so the per-type state must go with
    // it: otherwise the next subscriber would see a non-empty refcount, send no
    // start of its own, and listen forever to a stream that was never armed.
    const retry = startHealthUpdates("vo2Max", () => {});
    await expect(retry.started).rejects.toMatchObject({ code: "UNAVAILABLE" });
    // Each failure also sends a STOP. The per-type entry is gone, so no
    // subscriber can ever send one later, and some failures are ambiguous about
    // what native did — a timeout while the authorization sheet is up leaves a
    // query that may still arm. Native never refuses a stop for a stream that is
    // not running, so the redundant case (this one) costs a no-op invoke.
    expect(rejected).toEqual([
      "startHealthUpdates",
      "stopHealthUpdates",
      "startHealthUpdates",
      "stopHealthUpdates",
    ]);
  });

  it("keeps a retry's stream when a token from the FAILED start is dropped", async () => {
    // What the identity-TOKEN Set buys over a count plus the `cleaned` latch.
    // The first start fails, so its entry is deleted while its subscriber is
    // still holding a `stop` it has not called; a retry then creates a SECOND
    // entry with its own token. When the original finally cleans up, `cleaned`
    // is false — it never ran — so the only thing standing between it and a
    // spurious `stopHealthUpdates` that would kill the retry's live stream is
    // that its token is not a member of the new entry's set.
    const g = globalThis as Record<string, unknown>;
    const calls: string[] = [];
    let failNext = true;
    g.__host = {
      invoke: (id: number, method: string) => {
        calls.push(method);
        if (method === "startHealthUpdates" && failNext) {
          failNext = false;
          (g.__rejectInvoke as (i: number, j: string) => void)(
            id,
            JSON.stringify({ code: "UNAVAILABLE", message: "no HealthKit" }),
          );
          return;
        }
        (g.__resolveInvoke as (i: number, j: string) => void)(id, "null");
      },
    };
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const doomed = startHealthUpdates("stepCount", () => {});
    await expect(doomed.started).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    logged.mockRestore();

    const seen: number[] = [];
    const retry = startHealthUpdates("stepCount", (u) =>
      seen.push(u.samples.length),
    );
    await retry.started;
    calls.length = 0;

    doomed.stop();
    expect(calls).toEqual([]);
    dispatchNativeEvent(`${HEALTH_UPDATE_EVENT_PREFIX}stepCount`, {
      samples: [{ startMs: 1, endMs: 2, value: 9, unit: "count" }],
    });
    expect(seen).toEqual([1]);
    retry.stop();
    expect(calls).toEqual(["stopHealthUpdates"]);
  });

  it("never hands a handler a push it cannot read", () => {
    installHost(null);
    const seen: unknown[] = [];
    const live = startHealthUpdates("stepCount", (update) =>
      seen.push(update.samples.length),
    );
    // Native never pushes either of these — an update with nothing added is
    // dropped natively, and the key names are pinned by the ARCH-11 producer
    // scan — so both would be a native bug. Delivering them anyway would move
    // the failure into the screen's `samples.at(-1)`.
    dispatchNativeEvent(`${HEALTH_UPDATE_EVENT_PREFIX}stepCount`, {
      samples: [],
    });
    dispatchNativeEvent(`${HEALTH_UPDATE_EVENT_PREFIX}stepCount`, {});
    dispatchNativeEvent(`${HEALTH_UPDATE_EVENT_PREFIX}stepCount`, undefined);
    expect(seen).toEqual([]);
    live.stop();
  });

  it("gives a late subscriber the NEXT sample, never the last one", () => {
    installHost(null);
    dispatchNativeEvent(`${HEALTH_UPDATE_EVENT_PREFIX}heartRate`, {
      samples: [sample(61, 1)],
    });
    const seen: unknown[] = [];
    const live = startHealthUpdates("heartRate", (u) => seen.push(u));
    // EDGE-triggered: `health.samples.*` is deliberately absent from
    // `REPLAYED_EVENTS`, because replaying a sample would fabricate a reading
    // that did not just occur — a "current heart rate" screen would show a
    // number from before it mounted as if it had arrived live. A screen that
    // needs a value at mount reads one with queryHealthStatistics.
    expect(seen).toEqual([]);
    dispatchNativeEvent(`${HEALTH_UPDATE_EVENT_PREFIX}heartRate`, {
      samples: [sample(64, 2)],
    });
    expect(seen).toHaveLength(1);
    live.stop();
  });

  it("routes a deletions-only push to onDeleted and NOT to the sample handler", () => {
    // The case the feature exists for: the user deletes a sample in the Health
    // app while a live screen is open. Nothing was added, so the sample
    // handler must not run — its contract (samples non-empty, `latest`
    // guaranteed) is exactly what folding deletions in would have cost.
    installHost(null);
    const updates: unknown[] = [];
    const deletions: unknown[] = [];
    const live = startHealthUpdates("stepCount", (u) => updates.push(u), {
      onDeleted: (d) => deletions.push(d),
    });
    dispatchNativeEvent(`${HEALTH_UPDATE_EVENT_PREFIX}stepCount`, {
      samples: [],
      deletedIds: ["id-1", "id-2"],
    });
    expect(updates).toEqual([]);
    // Narrowed like the sample path: the handler gets a typed HealthDeletion
    // naming its own type, so one function can serve two subscriptions.
    expect(deletions).toEqual([{ type: "stepCount", ids: ["id-1", "id-2"] }]);
    // Nothing deleted -> onDeleted is not called with an empty list.
    dispatchNativeEvent(`${HEALTH_UPDATE_EVENT_PREFIX}stepCount`, {
      samples: [sample(12, 5)],
      deletedIds: [],
    });
    expect(deletions).toHaveLength(1);
    expect(updates).toHaveLength(1);
    live.stop();
  });

  it("applies adds before retractions when one push carries both", () => {
    // Deletions ride the same native batch as additions (same floor, same
    // merge), so a subscriber's buffer must see the add first — an add and its
    // own deletion merged into one push have to net out to GONE, not to a
    // deletion that misses followed by a row that sticks.
    installHost(null);
    const order: string[] = [];
    const live = startHealthUpdates(
      "heartRate",
      (u) => order.push(`samples:${u.samples.map((s) => s.id).join(",")}`),
      { onDeleted: (d) => order.push(`deleted:${d.ids.join(",")}`) },
    );
    dispatchNativeEvent(`${HEALTH_UPDATE_EVENT_PREFIX}heartRate`, {
      samples: [sample(61, 1), sample(64, 2)],
      deletedIds: ["id-1"],
    });
    expect(order).toEqual(["samples:id-1,id-2", "deleted:id-1"]);
    live.stop();
  });

  it("delivers deletions per SUBSCRIBER, not first-options-wins", () => {
    // `minIntervalMs` is a native knob on the one shared query, so the first
    // subscriber's value wins; `onDeleted` is JS routing, so each subscriber's
    // own choice holds — a screen that never opted in must not start receiving
    // retractions because a later subscriber did.
    installHost(null);
    const seen: string[][] = [];
    const plain = startHealthUpdates("stepCount", () => {});
    const buffered = startHealthUpdates("stepCount", () => {}, {
      onDeleted: (d) => seen.push(d.ids),
    });
    dispatchNativeEvent(`${HEALTH_UPDATE_EVENT_PREFIX}stepCount`, {
      samples: [],
      deletedIds: ["id-9"],
    });
    expect(seen).toEqual([["id-9"]]);
    plain.stop();
    buffered.stop();
  });

  it("subscribes per TYPE, so one type's samples reach only its own screen", () => {
    const calls = installHost(null);
    const steps: number[] = [];
    const bpm: number[] = [];
    const liveSteps = startHealthUpdates("stepCount", (u) =>
      steps.push(u.samples.length),
    );
    const liveBpm = startHealthUpdates("heartRate", (u) =>
      bpm.push(u.samples.length),
    );
    expect(calls.map((c) => c.payload)).toEqual([
      { type: "stepCount" },
      { type: "heartRate" },
    ]);
    dispatchNativeEvent(`${HEALTH_UPDATE_EVENT_PREFIX}heartRate`, {
      samples: [sample(61, 1)],
    });
    expect(steps).toEqual([]);
    expect(bpm).toEqual([1]);
    liveSteps.stop();
    liveBpm.stop();
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
