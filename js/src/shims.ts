import type { QuickJSHostGlobal } from "./host";
import { installFetch } from "./fetch";

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
      intervalMs?: number;
    }
    const timers = new Map<number, Timer>();
    const arm = (
      fn: (...args: unknown[]) => void,
      ms: number | undefined,
      args: unknown[],
      intervalMs?: number,
    ): number => {
      const id = nextTimerId++;
      timers.set(id, { run: () => fn(...args), intervalMs });
      g.__host?.setTimer(id, ms ?? 0);
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
    ): number => arm(fn, ms, args, ms ?? 0);
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
        timer.run();
        // Re-arm unless the callback cleared the interval.
        if (timers.has(id)) g.__host?.setTimer(id, timer.intervalMs);
      }
    };
  }

  if (typeof g.console === "undefined") {
    const write = (...args: unknown[]) =>
      g.__host?.log(args.map(String).join(" "));
    g.console = { log: write, info: write, warn: write, error: write };
  }

  if (typeof g.performance === "undefined") {
    g.performance = { now: () => Date.now() };
  }

  installFetch(g);
}
