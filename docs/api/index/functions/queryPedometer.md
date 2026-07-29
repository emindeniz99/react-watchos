[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / queryPedometer

# Function: queryPedometer()

> **queryPedometer**(`range`): `Promise`\<[`PedometerData`](../interfaces/PedometerData.md)\>

Defined in: [js/src/sensors.ts:186](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/sensors.ts#L186)

Historical steps/distance/floors for a window, from CoreMotion's own
on-device cache (roughly the last seven days) — no HealthKit involved, so it
needs no `health` grant.

Rejects `UNAVAILABLE` when the app has no `NSMotionUsageDescription` (set
`motion: true` in the config plugin): Apple documents that calling
CMPedometer without it **crashes the app**, so native refuses rather than
calling. `currentPace*`/`currentCadence*` are always absent here — Apple
documents them as nil on a historical query.

## Parameters

### range

#### endMs

`number`

#### startMs

`number`

## Returns

`Promise`\<[`PedometerData`](../interfaces/PedometerData.md)\>
