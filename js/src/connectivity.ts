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

/**
 * A phone<->watch message contract (DX-6): each key is a message name, its value
 * the payload type. Declare it once and share the same `T` on both sides (this
 * watch package and the iPhone companion) so messaging is type-checked end to
 * end instead of hand-rolled JSON.
 */
export type MessageContract = Record<string, unknown>;

/** Typed `send`/`on` over one {@link MessageContract}; see {@link defineMessages}. */
export interface TypedMessages<T extends MessageContract> {
  /** Send a typed message to the phone; resolves the phone's reply. */
  send<K extends keyof T & string>(
    name: K,
    payload: T[K],
  ): Promise<Record<string, unknown>>;
  /** Handle a typed message from the phone. Returns an unsubscribe. */
  on<K extends keyof T & string>(
    name: K,
    handler: (payload: T[K]) => void,
  ): Unsubscribe;
}

/**
 * Builds a typed wrapper over {@link sendToPhone}/{@link onPhoneMessage} for one
 * message contract (DX-6), turning "wire the JSON yourself" into "define once,
 * type-checked on both sides". Messages travel as `{ type, payload }`; `on`
 * dispatches by `type` and hands the handler the typed payload.
 *
 *     const m = defineMessages<{ togglePlay: { on: boolean } }>();
 *     m.on("togglePlay", ({ on }) => setPlaying(on)); // on: boolean
 *     await m.send("togglePlay", { on: true });
 */
export function defineMessages<T extends MessageContract>(): TypedMessages<T> {
  return {
    send(name, payload) {
      return sendToPhone({ type: name, payload });
    },
    on(name, handler) {
      return onPhoneMessage((message) => {
        if (message?.type === name) {
          handler(message.payload as T[typeof name]);
        }
      });
    },
  };
}
