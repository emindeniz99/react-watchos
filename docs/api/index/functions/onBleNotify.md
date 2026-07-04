[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / onBleNotify

# Function: onBleNotify()

> **onBleNotify**(`handler`): [`Unsubscribe`](../type-aliases/Unsubscribe.md)

Defined in: [js/src/bluetooth.ts:111](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/bluetooth.ts#L111)

Characteristic notifications: handler gets `{ characteristic, value }`,
plus `binary: true` when the peripheral's payload was not valid UTF-8 —
then `value` is its base64 encoding (the same fallback contract as fetch
response bodies). Text protocols see an unchanged payload shape.
Returns an unsubscribe.

## Parameters

### handler

[`NativeEventHandler`](../type-aliases/NativeEventHandler.md)

## Returns

[`Unsubscribe`](../type-aliases/Unsubscribe.md)
