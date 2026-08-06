[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / endWorkout

# Function: endWorkout()

> **endWorkout**(`options?`): `Promise`\<`WorkoutState`\>

Defined in: [js/src/workout.ts:168](https://github.com/emindeniz99/react-watchos/blob/main/js/src/workout.ts#L168)

Ends the workout and, by default, **saves** it as an `HKWorkout` — resolving
with the same snapshot [getWorkoutState](getWorkoutState.md) reports, so the saved id,
duration, energy and distance arrive without a second round trip.

`discard: true` throws it away instead. Apple's HIG requires an app to either
save automatically or offer an explicit save/discard choice; saving is the
default because it is the half that cannot lose the user's data.

Also **cancels** a [startWorkout](startWorkout.md) that has not finished starting — the
HealthKit authorization round trip is a real window, and an effect cleanup
that unmounts mid-start lands in it. That call resolves (with a `notStarted`
snapshot, since nothing ran and nothing was saved) and the pending
`startWorkout` rejects `UNAVAILABLE`. Rejects `UNAVAILABLE` only when there
is genuinely nothing to end.

## Parameters

### options?

#### discard?

`boolean`

## Returns

`Promise`\<`WorkoutState`\>
