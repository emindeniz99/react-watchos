import { invoke } from "./invoke";
import {
  type NativeEventHandler,
  registerNativeListener,
  type Unsubscribe,
} from "./nativeEvents";

/**
 * Extended runtime session (WKExtendedRuntimeSession): keeps the app running
 * for a bounded stretch after it would normally suspend — for a self-care /
 * mindfulness / physical-therapy style session where the screen may sleep but
 * your logic must keep ticking. Not a workout session (that's HealthKit +
 * sensors); this is the general "stay alive briefly" primitive.
 *
 * State transitions arrive on the push channel as `runtimeSession.state`
 * (`{ state: "running" | "invalidated", reason? }`) and an early-warning
 * `runtimeSession.willExpire` shortly before the system reclaims it.
 */
export const RUNTIME_STATE_EVENT = "runtimeSession.state";
export const RUNTIME_WILL_EXPIRE_EVENT = "runtimeSession.willExpire";

/**
 * Starts a session. Resolves when the session is actually RUNNING — the invoke
 * is parked on `WKExtendedRuntimeSession`'s delegate, not settled when the
 * request is submitted — and rejects `UNAVAILABLE` when the system declines:
 * a session is already active, or it invalidates immediately (the usual cause
 * being a missing runtime-session reason in the app's Info.plist, whose reason
 * string comes back in the error message).
 */
export function startExtendedRuntimeSession(): Promise<void> {
  return invoke("startExtendedRuntimeSession");
}

/** Ends the active session (idempotent). */
export function stopExtendedRuntimeSession(): Promise<void> {
  return invoke("stopExtendedRuntimeSession");
}

/** Session state changes: handler gets `{ state, reason? }`. */
export function onRuntimeSessionState(
  handler: NativeEventHandler,
): Unsubscribe {
  return registerNativeListener(RUNTIME_STATE_EVENT, handler);
}

/** Fires shortly before the system reclaims the session, so you can wrap up. */
export function onRuntimeSessionWillExpire(
  handler: NativeEventHandler,
): Unsubscribe {
  return registerNativeListener(RUNTIME_WILL_EXPIRE_EVENT, handler);
}
