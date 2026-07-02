import { invoke } from "./invoke";

/**
 * Device info (WKInterfaceDevice): a one-shot snapshot of the watch's
 * hardware/state. watchOS exposes no battery-change *notification* (unlike
 * iOS) — poll `getDeviceInfo()` when you need a fresh reading, e.g. from a
 * `scheduleBackgroundRefresh` handler.
 */
export interface DeviceInfo {
  /** 0–1, or -1 when battery monitoring is unavailable. */
  batteryLevel: number;
  batteryState: "unknown" | "unplugged" | "charging" | "full";
  /** Which wrist the watch is on, per the user's settings. */
  wristLocation: "left" | "right";
  /** Crown on the same side as the wrist, or the other side. */
  crownOrientation: "left" | "right";
  screenWidth: number;
  screenHeight: number;
  screenScale: number;
  layoutDirection: "leftToRight" | "rightToLeft";
  model: string;
  systemVersion: string;
  name: string;
}

/** Fetches the current device snapshot. Rejects (invoke `UNAVAILABLE`) when
 *  there's no device bridge (tests/Node). */
export function getDeviceInfo(): Promise<DeviceInfo> {
  return invoke<DeviceInfo>("getDeviceInfo");
}
