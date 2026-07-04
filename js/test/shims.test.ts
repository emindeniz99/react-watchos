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

  it("floors the setInterval re-arm period so interval(0) can't hot-loop", () => {
    withBareEngine(({ armed, fire }) => {
      const g = globalThis as Record<string, unknown>;
      let ticks = 0;
      const id = (g.setInterval as (fn: () => void, ms: number) => number)(
        () => ticks++,
        0,
      );
      // The FIRST fire may come immediately (browser-like)…
      expect(armed[armed.length - 1]).toEqual({ id, ms: 0 });
      fire(id);
      // …but every RE-ARM is floored to 4ms — a 0ms period would otherwise
      // round-trip a native timer per fire in a tight loop, pinning the
      // watch CPU (browsers clamp to ~4ms for the same reason).
      expect(armed[armed.length - 1]).toEqual({ id, ms: 4 });
      fire(id);
      expect(armed[armed.length - 1]).toEqual({ id, ms: 4 });
      expect(ticks).toBe(2);
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

  it("clearInterval from inside the callback cancels the re-armed timer", () => {
    withBareEngine(({ armed, cleared, fire }) => {
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
      // The interval re-arms BEFORE the callback runs (fixed rate), so the
      // in-callback clear must cancel that just-armed host timer.
      expect(armed.length).toBe(armedAfterCreate + 1);
      expect(cleared).toContain(id);
      fire(id);
      expect(ticks).toBe(1); // cleared → the map entry is gone, fire is a no-op
    });
  });

  it("a throwing interval callback does not kill the interval", () => {
    withBareEngine(({ armed, fire }) => {
      const g = globalThis as Record<string, unknown>;
      let ticks = 0;
      const id = (g.setInterval as (fn: () => void, ms: number) => number)(
        () => {
          ticks++;
          throw new Error("tick boom");
        },
        100,
      );
      expect(() => fire(id)).toThrow("tick boom");
      // Re-armed before the callback ran, so the throw can't strand it.
      expect(armed[armed.length - 1]).toEqual({ id, ms: 100 });
      expect(() => fire(id)).toThrow("tick boom");
      expect(ticks).toBe(2);
    });
  });

  it("clamps negative and NaN delays to 0 before they reach the host", () => {
    withBareEngine(({ armed }) => {
      const g = globalThis as Record<string, unknown>;
      const set = g.setTimeout as (fn: () => void, ms?: number) => number;
      const idNegative = set(() => {}, -5);
      const idNaN = set(() => {}, Number.NaN);
      const idMissing = set(() => {});
      expect(armed).toEqual([
        { id: idNegative, ms: 0 },
        { id: idNaN, ms: 0 },
        { id: idMissing, ms: 0 },
      ]);
      const interval = g.setInterval as (fn: () => void, ms?: number) => number;
      const idInterval = interval(() => {}, -100);
      expect(armed[armed.length - 1]).toEqual({ id: idInterval, ms: 0 });
    });
  });
});

// CR-8: a bare QuickJS console only had log/info/warn/error; the extras React
// dev builds and libraries call (debug/assert/group/table/dir) were undefined
// and threw on call. Drive the shim with console deleted and a recording host.
describe("console shim (QuickJS environment)", () => {
  function withBareConsole(body: (logged: string[]) => void): void {
    const g = globalThis as Record<string, unknown>;
    const savedConsole = g.console;
    delete g.console;
    const logged: string[] = [];
    g.__host = { log: (line: string) => logged.push(line) };
    installShims();
    try {
      body(logged);
    } finally {
      g.console = savedConsole;
      delete g.__host;
    }
  }

  it("defines the extra console methods so they never throw", () => {
    withBareConsole(() => {
      const c = (globalThis as Record<string, unknown>).console as Record<
        string,
        unknown
      >;
      for (const name of [
        "log",
        "info",
        "warn",
        "error",
        "debug",
        "trace",
        "dir",
        "group",
        "groupCollapsed",
        "groupEnd",
        "table",
        "assert",
        "count",
        "time",
        "timeEnd",
      ]) {
        expect(typeof c[name], name).toBe("function");
      }
    });
  });

  it("routes the printing methods to the host log", () => {
    withBareConsole((logged) => {
      const c = (globalThis as Record<string, unknown>).console as Record<
        string,
        (...a: unknown[]) => void
      >;
      c.debug("d");
      c.dir("x");
      c.group("g");
      c.table([1]);
      expect(logged).toContain("d");
      expect(logged.length).toBe(4);
    });
  });

  it("assert logs only when the condition is falsy", () => {
    withBareConsole((logged) => {
      const c = (globalThis as Record<string, unknown>).console as Record<
        string,
        (...a: unknown[]) => void
      >;
      c.assert(true, "should not appear");
      expect(logged.length).toBe(0);
      c.assert(false, "boom");
      expect(logged).toEqual(["Assertion failed: boom"]);
    });
  });

  it("never throws on an unprintable argument (null-prototype object)", () => {
    withBareConsole((logged) => {
      const c = (globalThis as Record<string, unknown>).console as Record<
        string,
        (...a: unknown[]) => void
      >;
      // String(Object.create(null)) throws (no toString) — a LOGGING call
      // must never crash the app.
      expect(() => c.log("value:", Object.create(null))).not.toThrow();
      expect(logged[0]).toContain("value:");
      expect(logged[0]).toContain("[object Object]");
    });
  });
});
