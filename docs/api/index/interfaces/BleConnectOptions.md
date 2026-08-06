[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / BleConnectOptions

# Interface: BleConnectOptions

Defined in: [js/src/bluetooth.ts:43](https://github.com/emindeniz99/react-watchos/blob/main/js/src/bluetooth.ts#L43)

Options for [bleConnect](../functions/bleConnect.md).

## Properties

### maxReconnectAttempts?

> `optional` **maxReconnectAttempts?**: `number`

Defined in: [js/src/bluetooth.ts:50](https://github.com/emindeniz99/react-watchos/blob/main/js/src/bluetooth.ts#L50)

Max auto-reconnect scan attempts after an unexpected drop before the bridge
gives up and stays disconnected. `0` disables auto-reconnect. Default 5.
Bounds the BLE radio so a peripheral that never re-advertises (out of range,
powered off) can't leave the central active-scanning forever.

***

### reconnectWindowMs?

> `optional` **reconnectWindowMs?**: `number`

Defined in: [js/src/bluetooth.ts:55](https://github.com/emindeniz99/react-watchos/blob/main/js/src/bluetooth.ts#L55)

How long (ms) each reconnect scan runs before that attempt is abandoned.
Default 60000 (1 min). Worst-case total scan time ≈ attempts × window.
