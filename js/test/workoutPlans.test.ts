import { afterEach, describe, expect, it } from "vitest";
import type { WorkoutPlanSpec } from "../src/workoutPlans";
import {
  listScheduledWorkoutPlans,
  openWorkoutPlanInWorkoutApp,
  paceToMetersPerSecond,
  removeAllScheduledWorkoutPlans,
  removeScheduledWorkoutPlan,
  requestWorkoutPlanAuthorization,
  scheduleWorkoutPlan,
} from "../src/workoutPlans";

/**
 * The JS half of the WorkoutKit plan package: what each wrapper actually puts
 * on the wire. The native side is watchOS-only, so what is provable here is the
 * NARROWING — the public discriminated union collapsing onto the flat
 * `kind`-discriminated wire struct without leaking a field that belongs to
 * another arm, which native refuses rather than ignores.
 */

const g = globalThis as Record<string, unknown>;

afterEach(() => {
  delete g.__host;
  delete g.__resolveInvoke;
  delete g.__rejectInvoke;
});

/** Records the payload each method received and settles from `results`. */
function installHost(results: Record<string, unknown> = {}) {
  const calls: { method: string; payload: unknown }[] = [];
  g.__host = {
    invoke: (id: number, method: string, payloadJson: string) => {
      calls.push({
        method,
        payload: payloadJson === "" ? undefined : JSON.parse(payloadJson),
      });
      const result = results[method];
      (g.__resolveInvoke as (i: number, j: string) => void)(
        id,
        result === undefined ? "" : JSON.stringify(result),
      );
    },
  };
  return calls;
}

const customPlan: WorkoutPlanSpec = {
  kind: "custom",
  id: "3F2504E0-4F89-41D3-9A0C-0305E82C3301",
  activityType: "running",
  location: "outdoor",
  displayName: "6 × 400m",
  warmup: { goal: { kind: "time", seconds: 600 } },
  blocks: [
    {
      iterations: 6,
      steps: [
        {
          purpose: "work",
          goal: { kind: "distance", meters: 400 },
          alert: { kind: "heartRateRange", lowerBpm: 150, upperBpm: 170 },
        },
        { purpose: "recovery", goal: { kind: "time", seconds: 90 } },
      ],
    },
  ],
  cooldown: { goal: { kind: "open" } },
};

describe("the plan narrowing", () => {
  it("sends the custom arm's fields and nothing from the other arms", async () => {
    const calls = installHost({
      scheduleWorkoutPlan: {
        id: "3F2504E0-4F89-41D3-9A0C-0305E82C3301",
        atMs: 1_768_476_600_000,
        complete: false,
      },
    });
    await scheduleWorkoutPlan(customPlan, 1_768_476_600_000);
    const payload = calls[0]?.payload as { plan: Record<string, unknown> };
    expect(calls[0]?.method).toBe("scheduleWorkoutPlan");
    expect(payload.plan.kind).toBe("custom");
    expect(payload.plan.displayName).toBe("6 × 400m");
    // The fields that belong to the OTHER two arms must be absent, not
    // present-and-undefined: native rejects a foreign field rather than
    // ignoring it, so leaking one here would reject a legal plan on a watch.
    for (const foreign of ["goal", "distanceMeters", "durationSeconds"]) {
      expect(foreign in payload.plan).toBe(false);
    }
    // Nested purpose rides the step, which is the one shape shared by warmup /
    // cooldown (no purpose) and interval steps (purpose required).
    const blocks = payload.plan.blocks as {
      steps: { purpose?: string }[];
      iterations?: number;
    }[];
    expect(blocks[0]?.iterations).toBe(6);
    expect(blocks[0]?.steps.map((s) => s.purpose)).toEqual([
      "work",
      "recovery",
    ]);
    expect(
      (payload.plan.warmup as { purpose?: string }).purpose,
    ).toBeUndefined();
  });

  it("omits an absent optional rather than sending undefined", async () => {
    // `location` omitted maps to WorkoutKit's own `.unknown` default — that is
    // why there is no third wire value for it — and `id` omitted means native
    // mints one. Both have to be genuinely absent from the JSON.
    const calls = installHost({ scheduleWorkoutPlan: {} });
    await scheduleWorkoutPlan(
      {
        kind: "pacer",
        activityType: "running",
        distanceMeters: 5000,
        durationSeconds: 1500,
      },
      1_768_476_600_000,
    );
    const plan = (calls[0]?.payload as { plan: Record<string, unknown> }).plan;
    expect(plan).toEqual({
      kind: "pacer",
      activityType: "running",
      distanceMeters: 5000,
      durationSeconds: 1500,
    });
  });

  it("carries the speed metric and never invents one for power", async () => {
    // The 10.0-vs-10.4 asymmetry made visible: speed takes the current/average
    // selector at our floor, power does not, so the power arms have no `metric`
    // to send and native refuses one if it ever appears.
    const calls = installHost({ scheduleWorkoutPlan: {} });
    await scheduleWorkoutPlan(
      {
        kind: "custom",
        activityType: "running",
        blocks: [
          {
            steps: [
              {
                purpose: "work",
                alert: {
                  kind: "speedThreshold",
                  metersPerSecond: 3.33,
                  metric: "average",
                },
              },
              {
                purpose: "work",
                alert: { kind: "powerThreshold", watts: 240 },
              },
            ],
          },
        ],
      },
      1_768_476_600_000,
    );
    const blocks = (
      calls[0]?.payload as {
        plan: { blocks: { steps: { alert: object }[] }[] };
      }
    ).plan.blocks;
    expect(blocks[0]?.steps[0]?.alert).toEqual({
      kind: "speedThreshold",
      metersPerSecond: 3.33,
      metric: "average",
    });
    expect(blocks[0]?.steps[1]?.alert).toEqual({
      kind: "powerThreshold",
      watts: 240,
    });
  });

  it("accepts a Date or ms for the instant, both ways", async () => {
    const calls = installHost({ scheduleWorkoutPlan: {} });
    await scheduleWorkoutPlan(customPlan, new Date(1_768_476_600_000));
    await removeScheduledWorkoutPlan(
      "3F2504E0-4F89-41D3-9A0C-0305E82C3301",
      1_768_476_600_000,
    );
    expect((calls[0]?.payload as { atMs: number }).atMs).toBe(
      1_768_476_600_000,
    );
    expect((calls[1]?.payload as { atMs: number }).atMs).toBe(
      1_768_476_600_000,
    );
  });
});

describe("the six ops", () => {
  it("route to their declared methods and pass results through", async () => {
    const summaries = [
      { id: "3F2504E0-4F89-41D3-9A0C-0305E82C3301", atMs: 1, complete: true },
    ];
    const calls = installHost({
      requestWorkoutPlanAuthorization: "authorized",
      listScheduledWorkoutPlans: summaries,
      removeScheduledWorkoutPlan: false,
    });
    expect(await requestWorkoutPlanAuthorization()).toBe("authorized");
    expect(await listScheduledWorkoutPlans()).toEqual(summaries);
    // The documented "it wasn't there" answer: a stale UI removing an
    // already-completed plan resolves false rather than rejecting.
    expect(
      await removeScheduledWorkoutPlan(
        "3F2504E0-4F89-41D3-9A0C-0305E82C3301",
        1,
      ),
    ).toBe(false);
    await removeAllScheduledWorkoutPlans();
    await openWorkoutPlanInWorkoutApp(customPlan);
    expect(calls.map((c) => c.method)).toEqual([
      "requestWorkoutPlanAuthorization",
      "listScheduledWorkoutPlans",
      "removeScheduledWorkoutPlan",
      "removeAllScheduledWorkoutPlans",
      "openWorkoutPlanInWorkoutApp",
    ]);
    // The three argument-less ops send no payload at all.
    expect(calls[0]?.payload).toBeUndefined();
    expect(calls[1]?.payload).toBeUndefined();
    expect(calls[3]?.payload).toBeUndefined();
  });

  it("surfaces the scheduler's honest refusal instead of a silent success", async () => {
    // The whole reason the native side reads back after writing: Apple's
    // `schedule` is non-throwing and returns nothing, so "it worked" would
    // otherwise be indistinguishable from "nothing was stored".
    g.__host = {
      invoke: (id: number) => {
        (g.__rejectInvoke as (i: number, j: string) => void)(
          id,
          JSON.stringify({
            code: "UNAVAILABLE",
            message:
              "the scheduler accepted nothing — watch-side scheduling may be " +
              "unsupported on this configuration",
          }),
        );
      },
    };
    await expect(
      scheduleWorkoutPlan(customPlan, 1_768_476_600_000),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
});

describe("paceToMetersPerSecond", () => {
  it("converts min/km to m/s, which is the reciprocal a caller gets wrong", () => {
    // 5:00/km is 3.33 m/s. Passing `5` straight into a speed field would ask
    // for a 3-minute kilometre — silently, which is why the helper exists and
    // why the wire field is named `metersPerSecond` rather than "pace".
    expect(paceToMetersPerSecond(5)).toBeCloseTo(3.3333, 4);
    expect(paceToMetersPerSecond(4)).toBeCloseTo(4.1667, 4);
    // Round trip: a 6:00/km pace back out is 6 minutes per km.
    expect(1000 / paceToMetersPerSecond(6) / 60).toBeCloseTo(6, 10);
    // Faster pace = higher speed. The direction IS the bug being prevented.
    expect(paceToMetersPerSecond(4)).toBeGreaterThan(paceToMetersPerSecond(5));
  });
});
