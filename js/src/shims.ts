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

  // Minimal fetch over the host bridge: __host.fetch arms an async
  // URLSession request keyed by id; Swift settles it on the main thread via
  // __resolveFetch/__rejectFetch (the Promise resolution then commits any
  // resulting React update through the scheduler).
  if (typeof g.fetch !== "function") {
    let nextFetchId = 1;
    interface Pending {
      resolve: (response: unknown) => void;
      reject: (error: unknown) => void;
    }
    const pending = new Map<number, Pending>();
    const makeResponse = (r: {
      status?: number;
      headers?: Record<string, string>;
      body?: string;
    }) => {
      const status = r.status ?? 0;
      const body = r.body ?? "";
      return {
        status,
        ok: status >= 200 && status < 300,
        headers: r.headers ?? {},
        text: () => Promise.resolve(body),
        json: () => Promise.resolve(JSON.parse(body || "null")),
      };
    };
    g.fetch = (
      url: string,
      options?: {
        method?: string;
        headers?: Record<string, string>;
        body?: string;
      },
    ): Promise<unknown> =>
      new Promise((resolve, reject) => {
        const id = nextFetchId++;
        pending.set(id, { resolve, reject });
        g.__host?.fetch?.(
          id,
          JSON.stringify({
            url,
            method: options?.method ?? "GET",
            headers: options?.headers ?? {},
            body: options?.body ?? null,
          }),
        );
      });
    g.__resolveFetch = (id: number, responseJson: string) => {
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      try {
        p.resolve(makeResponse(JSON.parse(responseJson)));
      } catch (error) {
        p.reject(error);
      }
    };
    g.__rejectFetch = (id: number, message: string) => {
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      p.reject(new Error(message));
    };
  }
}
