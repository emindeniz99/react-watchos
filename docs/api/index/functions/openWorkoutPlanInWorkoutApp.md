[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / openWorkoutPlanInWorkoutApp

# Function: openWorkoutPlanInWorkoutApp()

> **openWorkoutPlanInWorkoutApp**(`plan`): `Promise`\<`void`\>

Defined in: [js/src/workoutPlans.ts:483](https://github.com/emindeniz99/react-watchos/blob/main/js/src/workoutPlans.ts#L483)

Hands `plan` to the Workout app (`WorkoutPlan.openInWorkoutApp()`), which on
watchOS **launches it** — your app leaves the foreground.

Resolving means the Workout app was handed the plan. It does **not** mean the
user started it, and Apple does not document when the call returns, so this
uses the user-mediated watchdog. Do not treat resolution as a workout
beginning — use [onWorkoutState](onWorkoutState.md) for that, which describes an
`HKWorkoutSession` your app owns.

This is the one API in this module that is watchOS-native beyond doubt (it
does not exist on iOS at all), and it needs no scheduling authorization.

## Parameters

### plan

[`WorkoutPlanSpec`](../type-aliases/WorkoutPlanSpec.md)

## Returns

`Promise`\<`void`\>
