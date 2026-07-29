[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / WorkoutMetrics

# Interface: WorkoutMetrics

Defined in: [js/src/workout.ts:91](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/workout.ts#L91)

Live metrics payload on [WORKOUT\_METRICS\_EVENT](../variables/WORKOUT_METRICS_EVENT.md). Each optional field
 is absent until HealthKit has collected that quantity for this workout.

## Properties

### activeEnergyKcal?

> `optional` **activeEnergyKcal?**: `number`

Defined in: [js/src/workout.ts:94](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/workout.ts#L94)

***

### distanceMeters?

> `optional` **distanceMeters?**: `number`

Defined in: [js/src/workout.ts:101](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/workout.ts#L101)

Distance in metres, from the quantity type matching the activity
 (cycling and swimming record under their own types).

 There is deliberately no `pace`: HealthKit exposes no workout pace
 quantity, so it would only ever be `distance / elapsed`, which the caller
 can compute. For real pace and cadence use `startPedometer`.

***

### elapsedMs

> **elapsedMs**: `number`

Defined in: [js/src/workout.ts:92](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/workout.ts#L92)

***

### heartRateBpm?

> `optional` **heartRateBpm?**: `number`

Defined in: [js/src/workout.ts:93](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/workout.ts#L93)
