[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / bleSubscribe

# Function: bleSubscribe()

> **bleSubscribe**(`characteristicUUID`): `Promise`\<`void`\>

Defined in: [js/src/bluetooth.ts:95](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/bluetooth.ts#L95)

Subscribe to notifications from a characteristic (position, title, …).
Resolves when the peripheral acknowledges the notification-state change;
values then stream in on [onBleNotify](onBleNotify.md). Re-subscribing the same
characteristic before the first settles rejects the first.

## Parameters

### characteristicUUID

`string`

## Returns

`Promise`\<`void`\>
