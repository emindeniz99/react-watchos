import { afterEach, describe, expect, it } from "vitest";
import { installShims } from "../src/shims";

// Exercises the QuickJS timer shims by simulating a bare engine: delete the
// native timer globals, install a __host that records armed/cleared timers,
// then drive __fireTimer the way JSRuntime.swift does.
type Armed = { id: number; ms: number };

const TIMER_GLOBALS = [
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "__fireTimer",
] as const;

function withBareEngine(
  body: (ctx: {
    armed: Armed[];
    cleared: number[];
    fire: (id: number) => void;
  }) => void,
): void {
  const g = globalThis as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  for (const k of TIMER_GLOBALS) {
    saved[k] = g[k];
    delete g[k];
  }
  const armed: Armed[] = [];
  const cleared: number[] = [];
  g.__host = {
    setTimer: (id: number, ms: number) => armed.push({ id, ms }),
    clearTimer: (id: number) => cleared.push(id),
    log: () => {},
  };
  installShims();
  try {
    body({
      armed,
      cleared,
      fire: (id) => (g.__fireTimer as (i: number) => void)(id),
    });
  } finally {
    for (const k of TIMER_GLOBALS) g[k] = saved[k];
    delete g.__host;
  }
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__host;
});

describe("timer shims (QuickJS environment)", () => {
  it("setInterval re-arms and fires repeatedly until cleared", () => {
    withBareEngine(({ armed, cleared, fire }) => {
      let ticks = 0;
      const g = globalThis as Record<string, unknown>;
      const id = (g.setInterval as (fn: () => void, ms: number) => number)(
        () => ticks++,
        100,
      );
      expect(armed).toEqual([{ id, ms: 100 }]);
      expect(ticks).toBe(0);

      fire(id);
      expect(ticks).toBe(1);
      expect(armed[armed.length - 1]).toEqual({ id, ms: 100 }); // re-armed

      fire(id);
      expect(ticks).toBe(2);

      (g.clearInterval as (i: number) => void)(id);
      expect(cleared).toContain(id);
      fire(id);
      expect(ticks).toBe(2); // cleared → no further fires
    });
  });

  it("setTimeout fires once and does not re-arm", () => {
    withBareEngine(({ armed, fire }) => {
      let calls = 0;
      const g = globalThis as Record<string, unknown>;
      const id = (g.setTimeout as (fn: () => void, ms: number) => number)(
        () => calls++,
        50,
      );
      const armedCount = armed.length;
      fire(id);
      fire(id);
      expect(calls).toBe(1);
      expect(armed.length).toBe(armedCount); // one-shot, never re-armed
    });
  });

  it("clearInterval from inside the callback stops re-arming", () => {
    withBareEngine(({ armed, fire }) => {
      const g = globalThis as Record<string, unknown>;
      let id = 0;
      let ticks = 0;
      id = (g.setInterval as (fn: () => void, ms: number) => number)(() => {
        ticks++;
        (g.clearInterval as (i: number) => void)(id);
      }, 10);
      const armedAfterCreate = armed.length;
      fire(id);
      expect(ticks).toBe(1);
      expect(armed.length).toBe(armedAfterCreate); // not re-armed after clear
      fire(id);
      expect(ticks).toBe(1);
    });
  });
});
