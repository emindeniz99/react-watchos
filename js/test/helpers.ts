import { vi } from "vitest";
import type { SerializedNode } from "../src/index";

/** Recursive search for nodes of a type in a serialized tree. */
export function findByType(
  node: SerializedNode,
  type: string,
): SerializedNode[] {
  return [
    ...(node.type === type ? [node] : []),
    ...node.children.flatMap((child) => findByType(child, type)),
  ];
}

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
