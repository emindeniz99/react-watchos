import { vi } from "vitest";

// The query helpers are the public testing surface now; re-export so the
// existing suite exercises the same code consumers import.
export { findByText, findByType } from "../src/testing";

/**
 * Installs a fully-mocked `__host` global (every bridge method) and
 * returns it. Callers must delete `globalThis.__host` in afterEach.
 */
export function installMockHost() {
  const host = {
    commit: vi.fn(),
    log: vi.fn(),
    setTimer: vi.fn(),
    clearTimer: vi.fn(),
    publishWidgets: vi.fn(),
    getItem: vi.fn((_key: string): string | null => null),
    setItem: vi.fn(),
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
      } else {
        g.__rejectInvoke?.(
          id,
          JSON.stringify({ code: "UNKNOWN_METHOD", message: method }),
        );
      }
    }),
    scheduleNotification: vi.fn(),
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
