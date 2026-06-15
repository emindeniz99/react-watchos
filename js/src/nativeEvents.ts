/**
 * Named listeners for state pushed from native code (connection state,
 * sensors, incoming messages) — anything that isn't a user interaction.
 * Native calls `__pushNativeEvent(name, payloadJson)`, which runApp routes
 * through WatchRoot.runSync so the resulting React update commits
 * instantly, exactly like a tap, instead of on the scheduler's next turn.
 */

export type NativeEventHandler = (payload?: Record<string, unknown>) => void;

const listeners = new Map<string, NativeEventHandler>();

export function registerNativeListener(
  name: string,
  handler: NativeEventHandler,
): void {
  listeners.set(name, handler);
}

export function unregisterAllNativeListeners(): void {
  listeners.clear();
}

/** Invokes the listener for `name`; returns false if none is registered. */
export function dispatchNativeEvent(
  name: string,
  payload?: Record<string, unknown>,
): boolean {
  const handler = listeners.get(name);
  if (!handler) return false;
  handler(payload);
  return true;
}
