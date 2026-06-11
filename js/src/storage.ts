import type { QuickJSHostGlobal } from "./host";

/**
 * Key/value storage backed by App Group UserDefaults on the watch
 * (shared between the app and the widget extension, so intents handled
 * in the extension see the app's state). Falls back to in-memory storage
 * where the host has no storage bridge (tests, Node).
 */

const memoryFallback = new Map<string, string>();

function host(): QuickJSHostGlobal | undefined {
  return (globalThis as { __host?: QuickJSHostGlobal }).__host;
}

export const Storage = {
  getString(key: string): string | null {
    const h = host();
    if (h?.getItem) return h.getItem(key);
    return memoryFallback.get(key) ?? null;
  },

  setString(key: string, value: string): void {
    const h = host();
    if (h?.setItem) h.setItem(key, value);
    else memoryFallback.set(key, value);
  },

  get<T>(key: string): T | null {
    const raw = this.getString(key);
    if (raw == null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },

  set(key: string, value: unknown): void {
    this.setString(key, JSON.stringify(value));
  },

  /** Test helper: clears the in-memory fallback only. */
  clearMemoryFallback(): void {
    memoryFallback.clear();
  },
};
