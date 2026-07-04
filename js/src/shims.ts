import { installFetch } from "./fetch";
import type { QuickJSHostGlobal } from "./host";

/**
 * Fills in the platform globals React and scheduler expect but bare
 * QuickJS lacks. Timers are driven by Swift: setTimeout asks the host to
 * arm a timer, and JSRuntime.swift calls `__fireTimer(id)` when it fires.
 * No-ops on Node, where everything already exists.
 */
export function installShims(): void {
  const g = globalThis as Record<string, unknown> & {
    __host?: QuickJSHostGlobal;
  };

  if (typeof g.queueMicrotask !== "function") {
    g.queueMicrotask = (fn: () => void) => {
      Promise.resolve().then(fn);
    };
  }

  if (typeof g.setTimeout !== "function") {
    let nextTimerId = 1;
    interface Timer {
      run: () => void;
      /** Set for setInterval; the period to re-arm with after each fire. */
      intervalMs?: number | undefined;
    }
    const timers = new Map<number, Timer>();
    // Browsers/Node clamp bad delays to 0; forward the same to the host so a
    // setTimeout(fn, -5) or NaN delay never reaches native verbatim.
    const clampDelay = (ms: number | undefined): number => {
      const n = Number(ms);
      return n > 0 ? n : 0;
    };
    const arm = (
      fn: (...args: unknown[]) => void,
      ms: number | undefined,
      args: unknown[],
      intervalMs?: number,
    ): number => {
      const id = nextTimerId++;
      timers.set(id, { run: () => fn(...args), intervalMs });
      g.__host?.setTimer(id, clampDelay(ms));
      return id;
    };
    g.setTimeout = (
      fn: (...args: unknown[]) => void,
      ms?: number,
      ...args: unknown[]
    ): number => arm(fn, ms, args);
    // setInterval rides on the host's one-shot timer: re-arm in __fireTimer
    // after each callback. QuickJS has no native setInterval, so an
    // interval-driven update would otherwise throw and never commit.
    g.setInterval = (
      fn: (...args: unknown[]) => void,
      ms?: number,
      ...args: unknown[]
    ): number =>
      // Floor the RE-ARM period like browsers (~4ms): setInterval(fn, 0)
      // would otherwise hot-loop the native timer bridge — every fire
      // immediately re-arms a 0ms host timer, pinning the watch's CPU.
      arm(fn, ms, args, Math.max(4, clampDelay(ms)));
    g.clearTimeout = (id: number) => {
      timers.delete(id);
      g.__host?.clearTimer?.(id);
    };
    g.clearInterval = g.clearTimeout;
    g.__fireTimer = (id: number) => {
      const timer = timers.get(id);
      if (!timer) return;
      if (timer.intervalMs === undefined) {
        timers.delete(id);
        timer.run();
      } else {
        // Re-arm BEFORE running: the period stays fixed instead of drifting
        // by the callback's duration, and a throwing callback can't silently
        // kill the interval (the exception still propagates to the host's
        // onError). A callback that calls clearInterval wins — clearTimeout
        // cancels the just-armed host timer too.
        g.__host?.setTimer(id, timer.intervalMs);
        timer.run();
      }
    };
  }

  if (typeof g.console === "undefined") {
    // String(arg) throws on a null-prototype object (no toString) — a logging
    // call must never crash the app, so fall back to the tag/spec default.
    const safeString = (arg: unknown): string => {
      try {
        return String(arg);
      } catch {
        try {
          return Object.prototype.toString.call(arg);
        } catch {
          return "[unprintable]";
        }
      }
    };
    const write = (...args: unknown[]) =>
      g.__host?.log(args.map(safeString).join(" "));
    const noop = () => {};
    // React dev builds and libraries reach for more than log/info/warn/error;
    // the rest are `undefined` in bare QuickJS and throw on call. Alias the
    // printing methods (debug/trace/dir/group/table) to the host log and
    // no-op the structural/measurement ones so no console call ever crashes.
    g.console = {
      log: write,
      info: write,
      warn: write,
      error: write,
      debug: write,
      trace: write,
      dir: write,
      group: write,
      groupCollapsed: write,
      table: write,
      assert: (condition: unknown, ...args: unknown[]) => {
        if (!condition) write("Assertion failed:", ...args);
      },
      groupEnd: noop,
      count: noop,
      countReset: noop,
      time: noop,
      timeEnd: noop,
      timeLog: noop,
    };
  }

  if (typeof g.performance === "undefined") {
    // quickjs-ng (JS_AddPerformance) and Node both ship a monotonic
    // performance.now(), so on our targets this branch is never taken and the
    // engine's monotonic clock is used. It's only a last-resort fallback for a
    // bare engine without `performance`; Date.now() is wall-clock (a clock
    // adjustment can make a delta go backwards), but React's scheduler
    // tolerates that and we have no monotonic source without performance.now().
    g.performance = { now: () => Date.now() };
  }

  installFetch(g);
}
