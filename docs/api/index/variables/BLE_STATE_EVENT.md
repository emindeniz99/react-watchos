[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / BLE\_STATE\_EVENT

# Variable: BLE\_STATE\_EVENT

> `const` **BLE\_STATE\_EVENT**: `"ble.state"` = `"ble.state"`

Defined in: [js/src/bluetooth.ts:32](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/bluetooth.ts#L32)

BLE central over CoreBluetooth, for talking to a peripheral like a laptop
running a "movie remote" GATT service. watchOS supports the central role
only, so the watch connects to and drives the peripheral.

`bleConnect`/`bleWrite`/`bleSubscribe` return a Promise that settles with the
op's result (CX-022) — a failed connect or unacked write rejects instead of
silently vanishing. Connection state and characteristic notifications still
arrive on the native-event push channel (`onBleState`/`onBleNotify`), which
stays the source of truth for *ongoing* state; the promise is just the
one-shot result of the call you made. All values are strings (UTF-8 or
base64, per your service).

The bridge auto-reconnects: an unexpected drop (range/power) re-scans and,
once reconnected, re-subscribes to the same characteristics — you'll see
`disconnected` -> `scanning` -> `connected` on `onBleState`. Reconnection is
BOUNDED (default 5 attempts × 60s, tunable via `bleConnect` options): if the
peripheral never returns, the bridge stops scanning and stays `disconnected`
rather than draining the radio forever. The original `bleConnect` promise
resolves only on the FIRST connect, not on auto-reconnects. Calling
`bleDisconnect()` stays disconnected (no auto-reconnect) and rejects any
in-flight connect/write/subscribe.
