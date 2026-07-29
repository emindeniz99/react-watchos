import { afterEach, describe, expect, it } from "vitest";
import {
  queryHealthSamples,
  queryHealthStatistics,
  querySleepSamples,
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

  it("resolves the authorization signal verbatim, not a grant verdict", async () => {
    installHost("alreadyRequested");
    expect(await requestHealthAuthorization({ read: ["heartRate"] })).toBe(
      "alreadyRequested",
    );
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
