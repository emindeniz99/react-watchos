[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / paceToMetersPerSecond

# Function: paceToMetersPerSecond()

> **paceToMetersPerSecond**(`minutesPerKilometer`): `number`

Defined in: [js/src/workoutPlans.ts:247](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/workoutPlans.ts#L247)

Converts a running **pace** (minutes per kilometer) to the **speed**
(meters per second) the alert fields take.

This exists because the two are reciprocals and getting it backwards is
silent: `paceToMetersPerSecond(5)` — a 5:00/km pace — is `3.33` m/s, and an
alert built from `5` directly would target a 3-minute kilometer instead. The
wire says `metersPerSecond` for exactly that reason; Apple's API is
`UnitSpeed` even where the UI says "pace".

```ts
{ kind: "speedThreshold", metersPerSecond: paceToMetersPerSecond(5) }
```

## Parameters

### minutesPerKilometer

`number`

## Returns

`number`
