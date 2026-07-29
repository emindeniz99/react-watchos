[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / stopSensor

# Function: stopSensor()

> **stopSensor**(`kind`): `void`

Defined in: [js/src/sensors.ts:91](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/sensors.ts#L91)

Force-stops a kind's native stream regardless of remaining subscribers.
 Drops all current tokens, so their outstanding cleanups become no-ops.

## Parameters

### kind

[`SensorKind`](../type-aliases/SensorKind.md)

## Returns

`void`
