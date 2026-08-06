[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / startWorkout

# Function: startWorkout()

> **startWorkout**(`activityType`, `options?`): `Promise`\<`void`\>

Defined in: [js/src/workout.ts:125](https://github.com/emindeniz99/react-watchos/blob/main/js/src/workout.ts#L125)

Starts a workout. Resolves when the session is actually **running** — the
invoke is parked on `HKWorkoutSession`'s delegate, not settled when the
request is submitted.

Rejects `UNAVAILABLE` when a workout is already running, the activity name
isn't a known `HKWorkoutActivityType`, or the watch has no HealthKit; and
`UNAVAILABLE` with the system's reason if the session ends before it starts
(which is what another app starting a workout looks like).

Requests its own share authorization as part of starting — that is what a
real workout app does, and it keeps one feature per method.

## Parameters

### activityType

[`WorkoutActivityType`](../type-aliases/WorkoutActivityType.md)

### options?

[`StartWorkoutOptions`](../interfaces/StartWorkoutOptions.md)

## Returns

`Promise`\<`void`\>
