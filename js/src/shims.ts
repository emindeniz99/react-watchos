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
    const timers = new Map<number, () => void>();
    g.setTimeout = (
      fn: (...args: unknown[]) => void,
      ms?: number,
      ...args: unknown[]
    ): number => {
      const id = nextTimerId++;
      timers.set(id, () => fn(...args));
      g.__host?.setTimer(id, ms ?? 0);
      return id;
    };
    g.clearTimeout = (id: number) => {
      timers.delete(id);
      g.__host?.clearTimer?.(id);
    };
    g.__fireTimer = (id: number) => {
      const fn = timers.get(id);
      timers.delete(id);
      fn?.();
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
}
