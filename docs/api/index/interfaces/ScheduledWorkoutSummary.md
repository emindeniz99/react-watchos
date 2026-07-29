[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / ScheduledWorkoutSummary

# Interface: ScheduledWorkoutSummary

Defined in: [js/src/workoutPlans.ts:200](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/workoutPlans.ts#L200)

One plan the Workout app is holding.

## Properties

### activityType?

> `optional` **activityType?**: [`WorkoutActivityType`](../type-aliases/WorkoutActivityType.md)

Defined in: [js/src/workoutPlans.ts:214](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/workoutPlans.ts#L214)

Absent when this binary's vocabulary has no name for the stored activity
 — omitted rather than reported as the wrong workout.

***

### atMs

> **atMs**: `number`

Defined in: [js/src/workoutPlans.ts:208](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/workoutPlans.ts#L208)

When it is scheduled, ms since epoch. **Minute granularity**: the
scheduler keys on year/month/day/hour/minute, so a plan scheduled at
`…:30.500` lists as `…:30.000`.

***

### complete

> **complete**: `boolean`

Defined in: [js/src/workoutPlans.ts:211](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/workoutPlans.ts#L211)

Set by the **Workout app** when the user finishes it. Nothing in this API
 writes it — reading it is how you learn a plan was done.

***

### id

> **id**: `string`

Defined in: [js/src/workoutPlans.ts:202](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/workoutPlans.ts#L202)

The plan's UUID — the one you passed, or the one native minted.
