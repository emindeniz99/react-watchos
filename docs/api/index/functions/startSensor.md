[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / startSensor

# Function: startSensor()

> **startSensor**(`kind`, `handler`, `startOptions?`): [`Unsubscribe`](../type-aliases/Unsubscribe.md)

Defined in: [js/src/sensors.ts:49](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/sensors.ts#L49)

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

### startOptions?

`Record`\<`string`, `unknown`\>

## Returns

[`Unsubscribe`](../type-aliases/Unsubscribe.md)
