[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / startSensor

# Function: startSensor()

> **startSensor**(`kind`, `handler`): [`Unsubscribe`](../type-aliases/Unsubscribe.md)

Defined in: [js/src/sensors.ts:45](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/sensors.ts#L45)

Starts a sensor and routes its readings to `handler` (`{ ...reading }`).
Returns a cleanup that removes the listener and, when it's the last
subscriber, stops the native stream — so `useEffect(() => startSensor(kind,
cb), [])` ties the sensor to the component's lifecycle. Multiple components
can subscribe to one kind; the stream lives until the last unsubscribes.

## Parameters

### kind

`string`

### handler

[`NativeEventHandler`](../type-aliases/NativeEventHandler.md)

## Returns

[`Unsubscribe`](../type-aliases/Unsubscribe.md)
