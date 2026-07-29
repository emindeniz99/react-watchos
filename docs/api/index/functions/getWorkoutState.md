[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / getWorkoutState

# Function: getWorkoutState()

> **getWorkoutState**(): `Promise`\<`WorkoutState`\>

Defined in: [js/src/workout.ts:182](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/workout.ts#L182)

The live session's state — and the last workout that ended, which is how a
workout ended by a runtime reload reaches the runtime that never started it
(`endedReason: "runtimeReload"`). The `ended*` fields persist until another
workout ends, so a screen can render "last workout" at any time.

## Returns

`Promise`\<`WorkoutState`\>
