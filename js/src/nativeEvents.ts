/**
 * Named listeners for state pushed from native code (connection state,
 * sensors, incoming messages) — anything that isn't a user interaction.
 * Native calls `__pushNativeEvent(name, payloadJson)`, which runApp routes
 * through WatchRoot.runSync so the resulting React update commits
 * instantly, exactly like a tap, instead of on the scheduler's next turn.
 */

export type NativeEventHandler = (payload?: Record<string, unknown>) => void;

/** A function that removes the listener it was returned for. */
export type Unsubscribe = () => void;

const listeners = new Map<string, Set<NativeEventHandler>>();

/**
 * Subscribes `handler` to native event `name`. Multiple handlers per event are
 * supported — each fires. Returns an unsubscribe function; use it as a React
 * effect's cleanup so unmounting a screen drops its listener (and doesn't
 * accumulate stale ones on remount):
 *
 * ```ts
 * useEffect(() => registerNativeListener("ble.state", onState), []);
 * ```
 */
export function registerNativeListener(
  name: string,
  handler: NativeEventHandler,
): Unsubscribe {
  let set = listeners.get(name);
  if (!set) {
    set = new Set();
    listeners.set(name, set);
  }
  set.add(handler);
  return () => {
    const current = listeners.get(name);
    current?.delete(handler);
    if (current && current.size === 0) listeners.delete(name);
  };
}

export function unregisterAllNativeListeners(): void {
  listeners.clear();
}

/** Invokes every listener for `name`; returns false if none is registered. */
export function dispatchNativeEvent(
  name: string,
  payload?: Record<string, unknown>,
): boolean {
  const set = listeners.get(name);
  if (!set || set.size === 0) return false;
  // Snapshot: a handler that (un)subscribes during dispatch mustn't disturb
  // this iteration.
  for (const handler of [...set]) handler(payload);
  return true;
}
