[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / bleConnect

# Function: bleConnect()

> **bleConnect**(`serviceUUID`): `Promise`\<`void`\>

Defined in: [js/src/bluetooth.ts:45](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/bluetooth.ts#L45)

Scan for and connect to the first peripheral advertising `serviceUUID`.
Resolves on the first successful connect; rejects on failure or after a
connect timeout (`UNAVAILABLE`). A second `bleConnect` before the first
settles rejects the first (`INVALID_REQUEST`).

## Parameters

### serviceUUID

`string`

## Returns

`Promise`\<`void`\>
