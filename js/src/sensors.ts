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

function sensor(op: "start" | "stop", kind: SensorKind): void {
  getHost()?.sensor?.(JSON.stringify({ op, kind }));
}

// Per-kind subscriber count. A sensor's native stream is shared, so it starts
// on the first subscriber (0->1) and stops only when the last one leaves
// (1->0). Without this, unmounting one component stops a stream others still
// use (CX-014).
const activeCounts = new Map<SensorKind, number>();

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
): Unsubscribe {
  const off = registerNativeListener(SENSOR_EVENT_PREFIX + kind, handler);
  const count = (activeCounts.get(kind) ?? 0) + 1;
  activeCounts.set(kind, count);
  if (count === 1) sensor("start", kind);
  let cleaned = false;
  return () => {
    // Idempotent: a double cleanup (or a cleanup after stopSensor) must not
    // drive the count negative or emit a spurious stop.
    if (cleaned) return;
    cleaned = true;
    off();
    const next = (activeCounts.get(kind) ?? 0) - 1;
    if (next <= 0) {
      activeCounts.delete(kind);
      sensor("stop", kind);
    } else {
      activeCounts.set(kind, next);
    }
  };
}

/** Force-stops a kind's native stream regardless of remaining subscribers. */
export function stopSensor(kind: SensorKind): void {
  activeCounts.delete(kind);
  sensor("stop", kind);
}

/** Test-only: clears the per-kind subscriber counts (not part of the public API). */
export function __resetSensorCountsForTest(): void {
  activeCounts.clear();
}

/** Live heart rate (bpm): handler gets `{ bpm }`. */
export function startHeartRate(handler: NativeEventHandler): Unsubscribe {
  return startSensor("heartRate", handler);
}

/** Device motion: handler gets `{ x, y, z }` (user acceleration). */
export function startMotion(handler: NativeEventHandler): Unsubscribe {
  return startSensor("motion", handler);
}

/** Gyroscope rotation rate: handler gets `{ x, y, z }` (rad/s). */
export function startGyroscope(handler: NativeEventHandler): Unsubscribe {
  return startSensor("gyroscope", handler);
}

/** Location: handler gets `{ latitude, longitude, speed, course }`. */
export function startLocation(handler: NativeEventHandler): Unsubscribe {
  return startSensor("location", handler);
}
