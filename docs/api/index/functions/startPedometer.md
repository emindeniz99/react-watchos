[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / startPedometer

# Function: startPedometer()

> **startPedometer**(`handler`, `options?`): [`Unsubscribe`](../type-aliases/Unsubscribe.md)

Defined in: [js/src/sensors.ts:171](https://github.com/emindeniz99/react-watchos/blob/main/js/src/sensors.ts#L171)

Live pedometer updates: handler gets a [PedometerData](../interfaces/PedometerData.md).

Under the `sensors` feature with the other CoreMotion streams, not `health`:
same framework, same `NSMotionUsageDescription`, same single OS consent
toggle ("Motion & Fitness"), so a user cannot grant one and deny the other.

Note the units in the field names — Apple's pace is **seconds per metre** and
cadence is **steps per second**, not the other way round. `currentPace*` and
`currentCadence*` are live-only and absent from [queryPedometer](queryPedometer.md).

## Parameters

### handler

[`NativeEventHandler`](../type-aliases/NativeEventHandler.md)

### options?

[`PedometerOptions`](../interfaces/PedometerOptions.md)

## Returns

[`Unsubscribe`](../type-aliases/Unsubscribe.md)
