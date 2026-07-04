import { getHost } from "./host";

/**
 * Key/value storage backed by App Group UserDefaults on the watch
 * (shared between the app and the widget extension, so intents handled
 * in the extension see the app's state). Falls back to in-memory storage
 * where the host has no storage bridge (tests, Node).
 */

const memoryFallback = new Map<string, string>();
// Counters are a distinct namespace (file-backed on the watch, not the
// UserDefaults KV) — the fallback mirrors that so tests/Node behave the same.
const counterFallback = new Map<string, number>();

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

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
    const json = JSON.stringify(value);
    // JSON.stringify(undefined | function | symbol) returns undefined — the
    // typed bridge would then persist the literal string "undefined", which
    // get() can never parse back. Fail loud instead of corrupting; store an
    // explicit null to clear a value (get() returns null for it).
    if (json === undefined) {
      throw new TypeError(
        `Storage.set("${key}"): value is not JSON-serializable ` +
          "(undefined/function/symbol) — set null to clear the key",
      );
    }
    this.setString(key, json);
  },

  /**
   * Current value of a cross-process-atomic counter (ARCH-05), 0 when unset.
   * Counters live in a separate, file-backed namespace from get/set so that
   * `counterAdd` can do an atomic read-modify-write the app and the widget
   * extension can share. Use these — not get/set — for any number two processes
   * increment.
   */
  counterValue(key: string): number {
    const h = getHost();
    if (h?.counterGet) return h.counterGet(key);
    return counterFallback.get(key) ?? 0;
  },

  /**
   * Atomically add `delta` to a counter, clamp the result to [min, max], persist
   * it, and return the new value. Cross-process safe on the watch (a file-
   * coordination claim wraps the whole RMW). Reset-to-floor is a large negative
   * delta. `writeCount` bumps so the intent runtime's dirty-tracking reloads
   * widgets, exactly like setItem.
   */
  counterAdd(key: string, delta: number, min: number, max: number): number {
    writeCount += 1;
    const h = getHost();
    if (h?.counterAdd) return h.counterAdd(key, delta, min, max);
    const next = clamp((counterFallback.get(key) ?? 0) + delta, min, max);
    counterFallback.set(key, next);
    return next;
  },

  /** Test helper: clears the in-memory fallback only. */
  clearMemoryFallback(): void {
    memoryFallback.clear();
    counterFallback.clear();
  },
};
