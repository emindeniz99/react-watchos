[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / listScheduledWorkoutPlans

# Function: listScheduledWorkoutPlans()

> **listScheduledWorkoutPlans**(): `Promise`\<[`ScheduledWorkoutSummary`](../interfaces/ScheduledWorkoutSummary.md)[]\>

Defined in: [js/src/workoutPlans.ts:430](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/workoutPlans.ts#L430)

Every plan the scheduler is holding, including ones scheduled by an earlier
launch. `complete` is the read that tells you the user finished one — the
Workout app sets it, and nothing in this API writes it.

## Returns

`Promise`\<[`ScheduledWorkoutSummary`](../interfaces/ScheduledWorkoutSummary.md)[]\>
