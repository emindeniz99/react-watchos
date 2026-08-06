[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / bleConnect

# Function: bleConnect()

> **bleConnect**(`serviceUUID`, `options?`): `Promise`\<`void`\>

Defined in: [js/src/bluetooth.ts:67](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/bluetooth.ts#L67)

Scan for and connect to the first peripheral advertising `serviceUUID`.
Resolves on the first successful connect; rejects on failure or after a
connect timeout (`UNAVAILABLE`). A second `bleConnect` before the first
settles rejects the first (`INVALID_REQUEST`).

`options` tunes the bounded auto-reconnect (see [BleConnectOptions](../interfaces/BleConnectOptions.md));
omit for the defaults (5 attempts × 60s).

## Parameters

### serviceUUID

`string`

### options?

[`BleConnectOptions`](../interfaces/BleConnectOptions.md)

## Returns

`Promise`\<`void`\>
