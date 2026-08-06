[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / stopSensor

# Function: stopSensor()

> **stopSensor**(`kind`): `void`

Defined in: [js/src/sensors.ts:104](https://github.com/emindeniz99/react-watchos/blob/main/js/src/sensors.ts#L104)

Force-stops a kind's native stream regardless of remaining subscribers.
 Drops all current tokens, so their outstanding cleanups become no-ops.

## Parameters

### kind

[`SensorKind`](../type-aliases/SensorKind.md)

## Returns

`void`
