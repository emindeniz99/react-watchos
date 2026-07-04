import { invoke } from "./invoke";
import {
  type NativeEventHandler,
  registerNativeListener,
  type Unsubscribe,
} from "./nativeEvents";

/**
 * Background app refresh (WKApplicationRefreshBackgroundTask): schedule a
 * wake-up, and when watchOS runs it the app is briefly alive to refresh data
 * (fetch, republish complications) before suspending again. The fire arrives
 * on the native-event push channel as `backgroundRefresh` with your userInfo.
 *
 * watchOS budgets these (roughly hourly for an active app); treat the interval
 * as a hint. Do your refresh, then optionally reschedule for the next one.
 */
export const BACKGROUND_REFRESH_EVENT = "backgroundRefresh";

/**
 * Asks watchOS to wake the app ~`afterMs` from now. `userInfo` is echoed back
 * on the fire event so you can tag why you scheduled it. Resolves once the
 * request is registered (not when it fires).
 */
export function scheduleBackgroundRefresh(
  afterMs: number,
  userInfo?: Record<string, unknown>,
): Promise<void> {
  return invoke("scheduleBackgroundRefresh", { afterMs, userInfo });
}

/**
 * Runs `handler` when a scheduled background refresh fires (`{ userInfo }`).
 * Keep the work short — the app suspends again when it returns. Returns an
 * unsubscribe.
 */
export function onBackgroundRefresh(handler: NativeEventHandler): Unsubscribe {
  return registerNativeListener(BACKGROUND_REFRESH_EVENT, handler);
}
