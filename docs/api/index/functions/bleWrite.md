[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / bleWrite

# Function: bleWrite()

> **bleWrite**(`characteristicUUID`, `value`, `options?`): `Promise`\<`void`\>

Defined in: [js/src/bluetooth.ts:110](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/bluetooth.ts#L110)

Write a value to a characteristic (a command like play/pause/seek). By
default the bridge writes reliably (`.withResponse`) when the characteristic
supports it; pass `{ confirm: false }` for a fast fire-and-forget write, or
`{ confirm: true }` to force an acknowledged one.

Resolves when the write is acknowledged for a reliable (`.withResponse`)
write, and rejects on a peripheral error (`INTERNAL`) or a drop
(`UNAVAILABLE`). **Caveat:** an unacknowledged (`.withoutResponse`) write
resolves *optimistically* the moment it's handed to CoreBluetooth — there's
no delivery ack, so "resolved" means "sent", not "delivered". Use
`{ confirm: true }` when you need a real delivery guarantee.

## Parameters

### characteristicUUID

`string`

### value

`string`

### options?

[`BleWriteOptions`](../interfaces/BleWriteOptions.md)

## Returns

`Promise`\<`void`\>
