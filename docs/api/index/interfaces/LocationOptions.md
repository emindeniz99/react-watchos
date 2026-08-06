[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / LocationOptions

# Interface: LocationOptions

Defined in: [js/src/sensors.ts:217](https://github.com/emindeniz99/react-watchos/blob/main/js/src/sensors.ts#L217)

Options for [startLocation](../functions/startLocation.md).

## Properties

### accuracy?

> `optional` **accuracy?**: `"navigation"` \| `"best"` \| `"tenMeters"` \| `"hundredMeters"` \| `"kilometer"`

Defined in: [js/src/sensors.ts:224](https://github.com/emindeniz99/react-watchos/blob/main/js/src/sensors.ts#L224)

Positioning accuracy — coarser keeps the GPS hardware colder. Default
"tenMeters" (right for maps/route tracking); use "best" or "navigation"
only for turn-by-turn-grade needs. Only the first subscriber's value
takes effect.

***

### distanceFilterMeters?

> `optional` **distanceFilterMeters?**: `number`

Defined in: [js/src/sensors.ts:231](https://github.com/emindeniz99/react-watchos/blob/main/js/src/sensors.ts#L231)

Minimum movement in meters between callbacks. Default 10.
