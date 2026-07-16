import { invoke } from "./invoke";
import {
  type NativeEventHandler,
  registerNativeListener,
  type Unsubscribe,
} from "./nativeEvents";

/**
 * Phone <-> watch messaging over WatchConnectivity, surfaced through the
 * native-event channel and SPLIT by delivery semantics (ARCH-12) — the three
 * channels carry different guarantees and a merged stream forced JS to guess
 * which one fired:
 *
 * | channel                | direction guarantees                                  |
 * |------------------------|-------------------------------------------------------|
 * | `sendToPhone` /        | interactive: needs the phone REACHABLE now; resolves  |
 * | {@link onPhoneMessage} | the phone's reply                                      |
 * | {@link updateApplicationContext} / {@link onApplicationContext} | latest-wins state: the counterpart gets the MOST RECENT context when it next wakes |
 * | {@link transferUserInfo} / {@link onUserInfo} | FIFO queue: every item delivered in order, queue survives suspension |
 *
 * Rule of thumb: request/reply → sendToPhone; "current state" sync (settings,
 * dashboard data) → updateApplicationContext; must-not-drop event streams
 * (logged workouts, purchases) → transferUserInfo.
 */
export const PHONE_MESSAGE_EVENT = "watchConnectivity";
export const APPLICATION_CONTEXT_EVENT = "watchConnectivity.applicationContext";
export const USER_INFO_EVENT = "watchConnectivity.userInfo";

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
 * Publishes latest-wins state to the paired iPhone in the BACKGROUND: the
 * phone receives the most recent context when it next wakes — no reachability
 * requirement, no queue (each call overwrites the previous context). Resolves
 * once handed to WCSession; rejects (`UNAVAILABLE`) when the session isn't
 * activated or (`INVALID_REQUEST`) on an oversized/non-plist payload. The
 * right channel for "current state" sync — settings, dashboard data.
 */
export function updateApplicationContext(
  context: Record<string, unknown>,
): Promise<void> {
  return invoke("updateApplicationContext", context);
}

/**
 * Queues a background transfer to the paired iPhone: every queued item is
 * delivered IN ORDER when the counterpart wakes, and the queue survives app
 * suspension. Resolves once queued (per-item delivery isn't observable).
 * The right channel for must-not-drop event streams — logged workouts,
 * completed purchases.
 */
export function transferUserInfo(
  userInfo: Record<string, unknown>,
): Promise<void> {
  return invoke("transferUserInfo", userInfo);
}

/** Latest-wins context pushed from the iPhone (its `updateApplicationContext`).
 *  Returns an unsubscribe. */
export function onApplicationContext(handler: NativeEventHandler): Unsubscribe {
  return registerNativeListener(APPLICATION_CONTEXT_EVENT, handler);
}

/** Queued userInfo transfers from the iPhone, delivered in order (its
 *  `transferUserInfo`). Returns an unsubscribe. */
export function onUserInfo(handler: NativeEventHandler): Unsubscribe {
  return registerNativeListener(USER_INFO_EVENT, handler);
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
