import { getHost } from "./host";
import {
  type NativeEventHandler,
  registerNativeListener,
} from "./nativeEvents";

/**
 * BLE central over CoreBluetooth, for talking to a peripheral like a laptop
 * running a "movie remote" GATT service. watchOS supports the central role
 * only, so the watch connects to and drives the peripheral. Commands go out
 * through __host.ble (an op channel); connection state and characteristic
 * notifications arrive on the native-event push channel (commit instantly
 * via runSync). All values are strings (UTF-8 or base64, per your service).
 *
 * The bridge auto-reconnects: an unexpected drop (range/power) re-scans and,
 * once reconnected, re-subscribes to the same characteristics — you'll see
 * `disconnected` -> `scanning` -> `connected` on `onBleState`. Calling
 * `bleDisconnect()` stays disconnected (no auto-reconnect).
 */
export const BLE_STATE_EVENT = "ble.state";
export const BLE_NOTIFY_EVENT = "ble.notify";

/** "scanning" | "connected" | "disconnected" | "unauthorized" | "poweredOff" */
export type BleState = string;

function ble(op: string, payload: Record<string, unknown> = {}): void {
  getHost()?.ble?.(JSON.stringify({ op, ...payload }));
}

/** Scan for and connect to the first peripheral advertising `serviceUUID`. */
export function bleConnect(serviceUUID: string): void {
  ble("connect", { service: serviceUUID });
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
 */
export function bleWrite(
  characteristicUUID: string,
  value: string,
  options?: BleWriteOptions,
): void {
  ble("write", {
    characteristic: characteristicUUID,
    value,
    ...(options?.confirm !== undefined ? { confirm: options.confirm } : {}),
  });
}

/** Subscribe to notifications from a characteristic (position, title, …). */
export function bleSubscribe(characteristicUUID: string): void {
  ble("subscribe", { characteristic: characteristicUUID });
}

/** Connection-state changes: handler gets `{ state }`. */
export function onBleState(handler: NativeEventHandler): void {
  registerNativeListener(BLE_STATE_EVENT, handler);
}

/** Characteristic notifications: handler gets `{ characteristic, value }`. */
export function onBleNotify(handler: NativeEventHandler): void {
  registerNativeListener(BLE_NOTIFY_EVENT, handler);
}
