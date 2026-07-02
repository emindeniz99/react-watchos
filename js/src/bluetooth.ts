import { getHost } from "./host";
import { invoke } from "./invoke";
import {
  type NativeEventHandler,
  registerNativeListener,
  type Unsubscribe,
} from "./nativeEvents";

/**
 * BLE central over CoreBluetooth, for talking to a peripheral like a laptop
 * running a "movie remote" GATT service. watchOS supports the central role
 * only, so the watch connects to and drives the peripheral.
 *
 * `bleConnect`/`bleWrite`/`bleSubscribe` return a Promise that settles with the
 * op's result (CX-022) — a failed connect or unacked write rejects instead of
 * silently vanishing. Connection state and characteristic notifications still
 * arrive on the native-event push channel (`onBleState`/`onBleNotify`), which
 * stays the source of truth for *ongoing* state; the promise is just the
 * one-shot result of the call you made. All values are strings (UTF-8 or
 * base64, per your service).
 *
 * The bridge auto-reconnects: an unexpected drop (range/power) re-scans and,
 * once reconnected, re-subscribes to the same characteristics — you'll see
 * `disconnected` -> `scanning` -> `connected` on `onBleState`. The original
 * `bleConnect` promise resolves only on the FIRST connect, not on auto-reconnects.
 * Calling `bleDisconnect()` stays disconnected (no auto-reconnect) and rejects
 * any in-flight connect/write/subscribe.
 */
export const BLE_STATE_EVENT = "ble.state";
export const BLE_NOTIFY_EVENT = "ble.notify";

/** "scanning" | "connected" | "disconnected" | "unauthorized" | "poweredOff" */
export type BleState = string;

function ble(op: string, payload: Record<string, unknown> = {}): void {
  getHost()?.ble?.(JSON.stringify({ op, ...payload }));
}

/**
 * Scan for and connect to the first peripheral advertising `serviceUUID`.
 * Resolves on the first successful connect; rejects on failure or after a
 * connect timeout (`UNAVAILABLE`). A second `bleConnect` before the first
 * settles rejects the first (`INVALID_REQUEST`).
 */
export function bleConnect(serviceUUID: string): Promise<void> {
  return invoke("bleConnect", { service: serviceUUID });
}

export function bleDisconnect(): void {
  ble("disconnect");
}

/** Options for {@link bleWrite}. */
export interface BleWriteOptions {
  /**
   * Reliable write (CoreBluetooth `.withResponse`): the peripheral acks
   * delivery, so the command can't be silently dropped under buffer pressure —
   * at a small latency cost. Omit to let the bridge default to reliable when
   * the characteristic supports it, else a fast unacknowledged write.
   */
  confirm?: boolean;
}

/**
 * Write a value to a characteristic (a command like play/pause/seek). By
 * default the bridge writes reliably (`.withResponse`) when the characteristic
 * supports it; pass `{ confirm: false }` for a fast fire-and-forget write, or
 * `{ confirm: true }` to force an acknowledged one.
 *
 * Resolves when the write is acknowledged for a reliable (`.withResponse`)
 * write, and rejects on a peripheral error (`INTERNAL`) or a drop
 * (`UNAVAILABLE`). **Caveat:** an unacknowledged (`.withoutResponse`) write
 * resolves *optimistically* the moment it's handed to CoreBluetooth — there's
 * no delivery ack, so "resolved" means "sent", not "delivered". Use
 * `{ confirm: true }` when you need a real delivery guarantee.
 */
export function bleWrite(
  characteristicUUID: string,
  value: string,
  options?: BleWriteOptions,
): Promise<void> {
  return invoke("bleWrite", {
    characteristic: characteristicUUID,
    value,
    ...(options?.confirm !== undefined ? { confirm: options.confirm } : {}),
  });
}

/**
 * Subscribe to notifications from a characteristic (position, title, …).
 * Resolves when the peripheral acknowledges the notification-state change;
 * values then stream in on {@link onBleNotify}. Re-subscribing the same
 * characteristic before the first settles rejects the first.
 */
export function bleSubscribe(characteristicUUID: string): Promise<void> {
  return invoke("bleSubscribe", { characteristic: characteristicUUID });
}

/** Connection-state changes: handler gets `{ state }`. Returns an unsubscribe. */
export function onBleState(handler: NativeEventHandler): Unsubscribe {
  return registerNativeListener(BLE_STATE_EVENT, handler);
}

/**
 * Characteristic notifications: handler gets `{ characteristic, value }`,
 * plus `binary: true` when the peripheral's payload was not valid UTF-8 —
 * then `value` is its base64 encoding (the same fallback contract as fetch
 * response bodies). Text protocols see an unchanged payload shape.
 * Returns an unsubscribe.
 */
export function onBleNotify(handler: NativeEventHandler): Unsubscribe {
  return registerNativeListener(BLE_NOTIFY_EVENT, handler);
}
