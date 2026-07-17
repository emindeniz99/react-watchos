[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / LocationOptions

# Interface: LocationOptions

Defined in: [js/src/sensors.ts:133](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/sensors.ts#L133)

Options for [startLocation](../functions/startLocation.md).

## Properties

### accuracy?

> `optional` **accuracy?**: `"navigation"` \| `"best"` \| `"tenMeters"` \| `"hundredMeters"` \| `"kilometer"`

Defined in: [js/src/sensors.ts:140](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/sensors.ts#L140)

Positioning accuracy — coarser keeps the GPS hardware colder. Default
"tenMeters" (right for maps/route tracking); use "best" or "navigation"
only for turn-by-turn-grade needs. Only the first subscriber's value
takes effect.

***

### distanceFilterMeters?

> `optional` **distanceFilterMeters?**: `number`

Defined in: [js/src/sensors.ts:147](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/sensors.ts#L147)

Minimum movement in meters between callbacks. Default 10.
