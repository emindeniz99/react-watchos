import { vi } from "vitest";

// The query helpers are the public testing surface now; re-export so the
// existing suite exercises the same code consumers import.
export { findByText, findByType } from "../src/testing";

/**
 * Installs a fully-mocked `__host` global (every bridge method) and
 * returns it. Callers must delete `globalThis.__host` in afterEach.
 */
export function installMockHost() {
  // Atomic counters (ARCH-05) are backed by a real Map so counterAdd actually
  // clamps + accumulates, mirroring CoordinatedCounterStore.
  const counters = new Map<string, number>();
  const host = {
    commit: vi.fn(),
    log: vi.fn(),
    setTimer: vi.fn(),
    clearTimer: vi.fn(),
    publishWidgets: vi.fn(),
    getItem: vi.fn((_key: string): string | null => null),
    setItem: vi.fn(),
    counterGet: vi.fn((key: string): number => counters.get(key) ?? 0),
    counterAdd: vi.fn(
      (key: string, delta: number, min: number, max: number): number => {
        const next = Math.max(
          min,
          Math.min(max, (counters.get(key) ?? 0) + delta),
        );
        counters.set(key, next);
        return next;
      },
    ),
    playHaptic: vi.fn(),
    // Generic invoke channel (SD-1): dispatch by method and settle the Promise,
    // mirroring native. saveUpdate accepts, requestNotificationPermission grants;
    // an unrouted method rejects with UNKNOWN_METHOD. Tests wanting another
    // outcome call .mockImplementation or __resolveInvoke/__rejectInvoke directly.
    invoke: vi.fn((id: number, method: string, _payloadJson: string) => {
      const g = globalThis as {
        __resolveInvoke?: (id: number, resultJson: string) => void;
        __rejectInvoke?: (id: number, errorJson: string) => void;
      };
      if (method === "saveUpdate") {
        g.__resolveInvoke?.(id, JSON.stringify({ accepted: true }));
      } else if (method === "requestNotificationPermission") {
        g.__resolveInvoke?.(id, JSON.stringify("granted"));
      } else if (method === "sendToPhone") {
        g.__resolveInvoke?.(id, JSON.stringify({ ok: true }));
      } else if (method === "scheduleNotification") {
        g.__resolveInvoke?.(id, "null");
      } else if (method === "getUpdateState") {
        g.__resolveInvoke?.(
          id,
          JSON.stringify({ source: "shipped", highWater: 0 }),
        );
      } else if (
        method === "bleConnect" ||
        method === "bleWrite" ||
        method === "bleSubscribe" ||
        method === "updateApplicationContext" ||
        method === "transferUserInfo"
      ) {
        g.__resolveInvoke?.(id, ""); // success → resolves void
      } else {
        g.__rejectInvoke?.(
          id,
          JSON.stringify({ code: "UNKNOWN_METHOD", message: method }),
        );
      }
    }),
    cancelNotification: vi.fn(),
    fetch: vi.fn(),
    abortFetch: vi.fn(),
    ble: vi.fn(),
    sensor: vi.fn(),
    generate: vi.fn(),
  };
  (globalThis as Record<string, unknown>).__host = host;
  return host;
}
