import { getHost } from "./host";
import {
  type NativeEventHandler,
  registerNativeListener,
  type Unsubscribe,
} from "./nativeEvents";

/**
 * Live sensor streams (heart rate via HealthKit, motion via CoreMotion).
 * start a kind and readings arrive on the native-event push channel as
 * `sensor.<kind>` (so each reading commits instantly via runSync). The
 * watch's standout app shape is sensor + complication, and this rides
 * watchOS 26's expanded real-time fitness APIs.
 */
export const SENSOR_EVENT_PREFIX = "sensor.";

export type SensorKind =
  | "heartRate"
  | "motion"
  | "gyroscope"
  | "location"
  | string;

function sensor(
  op: "start" | "stop",
  kind: SensorKind,
  extra?: Record<string, unknown>,
): void {
  getHost()?.sensor?.(JSON.stringify({ op, kind, ...extra }));
}

// Per-kind set of live subscriber TOKENS (not a count). A sensor's native
// stream is shared, so it starts on the first subscriber and stops when the last
// leaves (CX-014). A Set of identity tokens — rather than a bare count — is what
// makes a late cleanup safe: each cleanup removes only ITS OWN token, so after
// stopSensor() force-clears the kind (or a new subscriber restarts the stream),
// an outstanding cleanup from before the stop/restart isn't a member and is a
// no-op. A shared count would let that stale cleanup zero the new subscribers'
// stream or emit a spurious stop.
const activeTokens = new Map<SensorKind, Set<object>>();

/**
 * Starts a sensor and routes its readings to `handler` (`{ ...reading }`).
 * Returns a cleanup that removes the listener and, when it's the last
 * subscriber, stops the native stream — so `useEffect(() => startSensor(kind,
 * cb), [])` ties the sensor to the component's lifecycle. Multiple components
 * can subscribe to one kind; the stream lives until the last unsubscribes.
 */
export function startSensor(
  kind: SensorKind,
  handler: NativeEventHandler,
  startOptions?: Record<string, unknown>,
): Unsubscribe {
  const off = registerNativeListener(SENSOR_EVENT_PREFIX + kind, handler);
  const token = {};
  let tokens = activeTokens.get(kind);
  if (!tokens) {
    tokens = new Set<object>();
    activeTokens.set(kind, tokens);
  }
  // startOptions ride the start op, which is sent once (first subscriber) since
  // the native stream is shared — so the first subscriber's options win.
  if (tokens.size === 0) sensor("start", kind, startOptions);
  tokens.add(token);
  let cleaned = false;
  return () => {
    // Idempotent: a double cleanup, or a cleanup after stopSensor()/a restart,
    // must not drive a spurious stop — this token is no longer a member, so the
    // guarded delete below is a no-op.
    if (cleaned) return;
    cleaned = true;
    off();
    const set = activeTokens.get(kind);
    if (set?.delete(token) && set.size === 0) {
      activeTokens.delete(kind);
      sensor("stop", kind);
    }
  };
}

/** Force-stops a kind's native stream regardless of remaining subscribers.
 *  Drops all current tokens, so their outstanding cleanups become no-ops. */
export function stopSensor(kind: SensorKind): void {
  activeTokens.delete(kind);
  sensor("stop", kind);
}

/** Test-only: clears the per-kind subscriber tokens (not part of the public API). */
export function __resetSensorCountsForTest(): void {
  activeTokens.clear();
}

/** Options for {@link startHeartRate}. */
export interface HeartRateOptions {
  /**
   * Keep the heart-rate stream running when the app backgrounds. Default
   * `false`: the native side ends the underlying HealthKit workout session on
   * background (so the app suspends instead of staying alive with the sensor
   * hot) and restarts it on foreground — so a forgotten stop can't drain the
   * battery indefinitely. Set `true` only for a genuine background use case
   * (e.g. an active workout). While the stream is shared, only the FIRST
   * subscriber's value takes effect.
   */
  keepAliveInBackground?: boolean;
}

/** Live heart rate (bpm): handler gets `{ bpm }`. */
export function startHeartRate(
  handler: NativeEventHandler,
  options?: HeartRateOptions,
): Unsubscribe {
  return startSensor(
    "heartRate",
    handler,
    options?.keepAliveInBackground ? { keepAliveInBackground: true } : undefined,
  );
}

/** Options for {@link startMotion} / {@link startGyroscope}. */
export interface MotionOptions {
  /**
   * Update period in ms. Default 100 (10 Hz). Every reading crosses the
   * bridge and can commit a render, so raise this as far as your use case
   * tolerates — it is a direct battery knob. Only the FIRST subscriber's
   * value takes effect (the native stream is shared).
   */
  updateIntervalMs?: number;
}

/** Options for {@link startLocation}. */
export interface LocationOptions {
  /**
   * Positioning accuracy — coarser keeps the GPS hardware colder. Default
   * "tenMeters" (right for maps/route tracking); use "best" or "navigation"
   * only for turn-by-turn-grade needs. Only the first subscriber's value
   * takes effect.
   */
  accuracy?:
    | "navigation"
    | "best"
    | "tenMeters"
    | "hundredMeters"
    | "kilometer";
  /** Minimum movement in meters between callbacks. Default 10. */
  distanceFilterMeters?: number;
}

/** Device motion: handler gets `{ x, y, z }` (user acceleration). */
export function startMotion(
  handler: NativeEventHandler,
  options?: MotionOptions,
): Unsubscribe {
  return startSensor(
    "motion",
    handler,
    options?.updateIntervalMs !== undefined
      ? { updateIntervalMs: options.updateIntervalMs }
      : undefined,
  );
}

/** Gyroscope rotation rate: handler gets `{ x, y, z }` (rad/s). */
export function startGyroscope(
  handler: NativeEventHandler,
  options?: MotionOptions,
): Unsubscribe {
  return startSensor(
    "gyroscope",
    handler,
    options?.updateIntervalMs !== undefined
      ? { updateIntervalMs: options.updateIntervalMs }
      : undefined,
  );
}

/** Location: handler gets `{ latitude, longitude, speed, course }`. */
export function startLocation(
  handler: NativeEventHandler,
  options?: LocationOptions,
): Unsubscribe {
  return startSensor("location", handler, {
    ...(options?.accuracy ? { accuracy: options.accuracy } : {}),
    ...(options?.distanceFilterMeters !== undefined
      ? { distanceFilterMeters: options.distanceFilterMeters }
      : {}),
  });
}
