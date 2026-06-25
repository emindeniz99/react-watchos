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
    // Mirror native: settle the requestNotificationPermission Promise as granted
    // (CX-022). Tests wanting another status call __resolve/__reject directly.
    requestNotificationPermission: vi.fn((id: number) => {
      (
        globalThis as {
          __resolveNotificationPermission?: (
            id: number,
            status: string,
          ) => void;
        }
      ).__resolveNotificationPermission?.(id, "granted");
    }),
    scheduleNotification: vi.fn(),
    cancelNotification: vi.fn(),
    sendToPhone: vi.fn(),
    fetch: vi.fn(),
    abortFetch: vi.fn(),
    ble: vi.fn(),
    sensor: vi.fn(),
    // Mirror the native side: accept the update and settle the applyUpdate
    // Promise (CX-005). Tests that want a rejection call __rejectSaveUpdate.
    saveUpdate: vi.fn((id: number, _requestJson: string) => {
      (
        globalThis as {
          __resolveSaveUpdate?: (id: number, resultJson: string) => void;
        }
      ).__resolveSaveUpdate?.(id, "{}");
    }),
    generate: vi.fn(),
  };
  (globalThis as Record<string, unknown>).__host = host;
  return host;
}
