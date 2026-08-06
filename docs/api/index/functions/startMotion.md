[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / startMotion

# Function: startMotion()

> **startMotion**(`handler`, `options?`): [`Unsubscribe`](../type-aliases/Unsubscribe.md)

Defined in: [js/src/sensors.ts:235](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/sensors.ts#L235)

Device motion: handler gets `{ x, y, z }` (user acceleration).

## Parameters

### handler

[`NativeEventHandler`](../type-aliases/NativeEventHandler.md)

### options?

[`MotionOptions`](../interfaces/MotionOptions.md)

## Returns

[`Unsubscribe`](../type-aliases/Unsubscribe.md)
