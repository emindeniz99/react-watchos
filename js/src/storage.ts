import { getHost } from "./host";

/**
 * Key/value storage backed by App Group UserDefaults on the watch
 * (shared between the app and the widget extension, so intents handled
 * in the extension see the app's state). Falls back to in-memory storage
 * where the host has no storage bridge (tests, Node).
 */

const memoryFallback = new Map<string, string>();

// Monotonic count of writes through Storage. The intent runtime samples it
// around a handler to auto-reload widgets only when persisted state actually
// changed (so a no-op intent doesn't spend the WidgetKit reload budget) — see
// handleIntent. Not part of the public API.
let writeCount = 0;

/** How many writes Storage has seen. Used by the intent runtime's
 *  dirty-tracking; callers shouldn't depend on the absolute value, only on
 *  whether it changed across a handler. */
export function storageWrites(): number {
  return writeCount;
}

export const Storage = {
  getString(key: string): string | null {
    const h = getHost();
    if (h?.getItem) return h.getItem(key);
    return memoryFallback.get(key) ?? null;
  },

  setString(key: string, value: string): void {
    writeCount += 1;
    const h = getHost();
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
