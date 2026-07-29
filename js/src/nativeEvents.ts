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
 * Level-triggered events: state that *is*, not something that *happened*. Their
 * last payload is kept and replayed to a listener that registers after the
 * push, so a screen mounted mid-state learns it instead of waiting for the next
 * change — native pushes `luminanceReduced` once at boot and then only on
 * wrist movement, so a conditionally-mounted consumer would otherwise believe
 * luminance is normal while the display is dimmed.
 *
 * `scenePhase` qualifies on the same test and for the same reason: `background`
 * is a state the app IS in, native pushes on every transition, so the last
 * payload IS the current phase and replaying it cannot fabricate anything. It
 * differs from `luminanceReduced` in one way worth knowing rather than
 * discovering — there is no boot-time push (`.onChange(of: scenePhase)` carries
 * no `initial: true` and nothing re-pushes it after `jsReady`), so replay
 * covers "subscribed after a transition", not "subscribed before the first
 * one". Adding the initial push would be a native change with its own
 * `handleScenePhase` side effect at boot, so it is deliberately not smuggled in
 * here: a launched app is `active`, which is the state a caller already has.
 *
 * Edge-triggered events (sensor samples, incoming messages, transfers) must NOT
 * be listed: replaying one fabricates an event that did not occur.
 */
const REPLAYED_EVENTS = new Set<string>(["luminanceReduced", "scenePhase"]);
const lastReplayed = new Map<string, Record<string, unknown> | undefined>();

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
  // Level-triggered state: hand the newcomer what native last said, in its own
  // call stack (a throw belongs to the caller here, unlike the fan-out below).
  if (lastReplayed.has(name)) handler(lastReplayed.get(name));
  return () => {
    const current = listeners.get(name);
    current?.delete(handler);
    if (current && current.size === 0) listeners.delete(name);
  };
}

export function unregisterAllNativeListeners(): void {
  listeners.clear();
  lastReplayed.clear();
}

/** Invokes every listener for `name`; returns false if none is registered. */
export function dispatchNativeEvent(
  name: string,
  payload?: Record<string, unknown>,
): boolean {
  // Recorded before the no-listener bail: the boot push lands whether or not
  // anything is subscribed yet, and that is precisely the value a later
  // subscriber needs.
  if (REPLAYED_EVENTS.has(name)) lastReplayed.set(name, payload);
  const set = listeners.get(name);
  if (!set || set.size === 0) return false;
  // Snapshot: a handler that (un)subscribes during dispatch mustn't disturb
  // this iteration. Isolate each handler (match the tap path): one throwing
  // listener must not starve the others for this push — surface it (fail loud)
  // but still deliver the payload to everyone else.
  for (const handler of [...set]) {
    try {
      handler(payload);
    } catch (error) {
      console.error(`native-event listener for "${name}" threw:`, error);
    }
  }
  return true;
}
