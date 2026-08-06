[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / getCurrentLocation

# Function: getCurrentLocation()

> **getCurrentLocation**(): `Promise`\<[`Coordinate`](../interfaces/Coordinate.md)\>

Defined in: [js/src/maps.ts:51](https://github.com/emindeniz99/react-watchos/blob/main/js/src/maps.ts#L51)

Resolves the watch's current location as a single `{lat, lon}` fix — for
centering a map or biasing a [searchPOI](searchPOI.md) call. Prompts for When-In-Use
location permission the first time; rejects `PERMISSION_DENIED` when the user
(or a restriction) said no and `UNAVAILABLE` when no fix is obtainable (e.g.
a simulator with no location set), so callers should catch and fall back to a
default region. Both codes are in the closed import("./invoke").InvokeErrorCode set — a switch on them is exhaustive.

## Returns

`Promise`\<[`Coordinate`](../interfaces/Coordinate.md)\>
