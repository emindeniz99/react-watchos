[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / getCurrentLocation

# Function: getCurrentLocation()

> **getCurrentLocation**(): `Promise`\<[`Coordinate`](../interfaces/Coordinate.md)\>

Defined in: [js/src/maps.ts:49](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/maps.ts#L49)

Resolves the watch's current location as a single `{lat, lon}` fix — for
centering a map or biasing a [searchPOI](searchPOI.md) call. Prompts for When-In-Use
location permission the first time; rejects if permission is denied or no fix
is available (e.g. a simulator with no location set), so callers should catch
and fall back to a default region.

## Returns

`Promise`\<[`Coordinate`](../interfaces/Coordinate.md)\>
