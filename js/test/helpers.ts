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
    requestNotificationPermission: vi.fn(),
    scheduleNotification: vi.fn(),
    cancelNotification: vi.fn(),
    sendToPhone: vi.fn(),
    fetch: vi.fn(),
    abortFetch: vi.fn(),
    ble: vi.fn(),
    sensor: vi.fn(),
    saveUpdate: vi.fn(),
    generate: vi.fn(),
  };
  (globalThis as Record<string, unknown>).__host = host;
  return host;
}
