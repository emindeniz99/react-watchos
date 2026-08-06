[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / searchPOI

# Function: searchPOI()

> **searchPOI**(`query`, `options?`): `Promise`\<[`POIResult`](../interfaces/POIResult.md)[]\>

Defined in: [js/src/maps.ts:29](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/maps.ts#L29)

Searches MapKit for points of interest matching a natural-language `query`
(e.g. "coffee", "gas station"), biased to the given region. Returns up to 15
places; an empty or failed search resolves to `[]` (never rejects for "no
results"), so the caller can bind the array straight to `Map` annotations.

Async because it crosses the invoke channel to `MKLocalSearch`.

## Parameters

### query

`string`

### options?

[`POISearchOptions`](../interfaces/POISearchOptions.md) = `{}`

## Returns

`Promise`\<[`POIResult`](../interfaces/POIResult.md)[]\>
