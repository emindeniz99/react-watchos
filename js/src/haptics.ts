import { getHost } from "./host";

/** Mirrors WKHapticType cases (mapped in WatchApp.swift). */
export type HapticType =
  | "click"
  | "success"
  | "failure"
  | "notification"
  | "directionUp"
  | "directionDown"
  | "start"
  | "stop"
  | "retry";

/** Plays a haptic on the watch. No-op where the host has no haptics. */
export function playHaptic(type: HapticType = "click"): void {
  getHost()?.playHaptic?.(type);
}
