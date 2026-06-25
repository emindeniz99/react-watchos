import { invoke } from "./invoke";
import {
  type NativeEventHandler,
  registerNativeListener,
  type Unsubscribe,
} from "./nativeEvents";

/**
 * Phone <-> watch messaging over WatchConnectivity, surfaced through the
 * native-event channel. Incoming phone messages arrive as a native push
 * under PHONE_MESSAGE_EVENT (so they commit instantly via runSync);
 * sendToPhone goes out through the host bridge to WCSession.
 */
export const PHONE_MESSAGE_EVENT = "watchConnectivity";

/**
 * Sends a message to the paired iPhone and resolves its reply (CX-022). Rejects
 * (with an InvokeError `code`) when the phone isn't reachable, the message
 * couldn't be delivered, or there's no connectivity-capable host — so a failed
 * send no longer vanishes. Uses WCSession.sendMessage under the hood, which
 * needs the counterpart reachable.
 */
export function sendToPhone(
  message: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return invoke("sendToPhone", message);
}

/** Registers a handler for messages pushed from the iPhone. Returns an unsubscribe. */
export function onPhoneMessage(handler: NativeEventHandler): Unsubscribe {
  return registerNativeListener(PHONE_MESSAGE_EVENT, handler);
}
