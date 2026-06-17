import { getHost } from "./host";
import {
  type NativeEventHandler,
  registerNativeListener,
} from "./nativeEvents";

/**
 * Phone <-> watch messaging over WatchConnectivity, surfaced through the
 * native-event channel. Incoming phone messages arrive as a native push
 * under PHONE_MESSAGE_EVENT (so they commit instantly via runSync);
 * sendToPhone goes out through the host bridge to WCSession.
 */
export const PHONE_MESSAGE_EVENT = "watchConnectivity";

/** Sends a message to the paired iPhone (no-op if WatchConnectivity is absent). */
export function sendToPhone(message: Record<string, unknown>): void {
  getHost()?.sendToPhone?.(JSON.stringify(message));
}

/** Registers a handler for messages pushed from the iPhone. */
export function onPhoneMessage(handler: NativeEventHandler): void {
  registerNativeListener(PHONE_MESSAGE_EVENT, handler);
}
