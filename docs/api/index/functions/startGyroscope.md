[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / startGyroscope

# Function: startGyroscope()

> **startGyroscope**(`handler`, `options?`): [`Unsubscribe`](../type-aliases/Unsubscribe.md)

Defined in: [js/src/sensors.ts:249](https://github.com/emindeniz99/react-watchos/blob/main/js/src/sensors.ts#L249)

Gyroscope rotation rate: handler gets `{ x, y, z }` (rad/s).

## Parameters

### handler

[`NativeEventHandler`](../type-aliases/NativeEventHandler.md)

### options?

[`MotionOptions`](../interfaces/MotionOptions.md)

## Returns

[`Unsubscribe`](../type-aliases/Unsubscribe.md)
