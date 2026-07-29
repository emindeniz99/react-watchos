[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / endWorkout

# Function: endWorkout()

> **endWorkout**(`options?`): `Promise`\<`WorkoutState`\>

Defined in: [js/src/workout.ts:153](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/workout.ts#L153)

Ends the workout and, by default, **saves** it as an `HKWorkout` — resolving
with the same snapshot [getWorkoutState](getWorkoutState.md) reports, so the saved id,
duration, energy and distance arrive without a second round trip.

`discard: true` throws it away instead. Apple's HIG requires an app to either
save automatically or offer an explicit save/discard choice; saving is the
default because it is the half that cannot lose the user's data.

## Parameters

### options?

#### discard?

`boolean`

## Returns

`Promise`\<`WorkoutState`\>
