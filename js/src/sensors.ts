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

/**
 * Starts a sensor and routes its readings to `handler` (`{ ...reading }`).
 * Returns a cleanup that removes the listener AND stops the native stream, so
 * `useEffect(() => startSensor(kind, cb), [])` ties the sensor to the
 * component's lifecycle.
 */
export function startSensor(
  kind: SensorKind,
  handler: NativeEventHandler,
): Unsubscribe {
  const off = registerNativeListener(SENSOR_EVENT_PREFIX + kind, handler);
  sensor("start", kind);
  return () => {
    off();
    sensor("stop", kind);
  };
}

export function stopSensor(kind: SensorKind): void {
  sensor("stop", kind);
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
