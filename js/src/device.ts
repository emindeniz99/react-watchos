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
  /** Accessibility state (poll; watchOS has no change notification here). */
  reduceMotion: boolean;
  voiceOverRunning: boolean;
  /** Dynamic Type size, e.g. "UICTContentSizeCategoryL". */
  preferredContentSizeCategory: string;
  /**
   * i18n foundation (M7). QuickJS ships no `Intl` — `toLocaleString` renders
   * a hardcoded US-style format — so these host fields are how an app picks a
   * translation table and formats per user. `locale` is the full identifier
   * (e.g. "de_DE"), `language` the bare code ("de").
   */
  locale: string;
  language: string;
  /** The user's time-format preference (12h vs 24h clock). */
  is24Hour: boolean;
}

/** Fetches the current device snapshot. Rejects (invoke `UNAVAILABLE`) when
 *  there's no device bridge (tests/Node). */
export function getDeviceInfo(): Promise<DeviceInfo> {
  return invoke<DeviceInfo>("getDeviceInfo");
}

/**
 * Enables Water Lock (SwiftUI-less): locks the touch screen so submersion
 * can't register taps; the user turns the crown to unlock and the watch
 * ejects water. Only works on a water-resistant watch (wr50); rejects
 * otherwise.
 */
export function enableWaterLock(): Promise<void> {
  return invoke("enableWaterLock");
}
