[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / requestWorkoutPlanAuthorization

# Function: requestWorkoutPlanAuthorization()

> **requestWorkoutPlanAuthorization**(): `Promise`\<[`WorkoutPlanAuthorizationState`](../type-aliases/WorkoutPlanAuthorizationState.md)\>

Defined in: [js/src/workoutPlans.ts:384](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/workoutPlans.ts#L384)

Shows the WorkoutKit scheduling permission sheet and resolves the resulting
`AuthorizationState`.

Native reads the standing state **first** and prompts only when it is
`"notDetermined"`, so calling this again returns the current status without
re-prompting — the same contract [requestCalendarAccess](requestCalendarAccess.md) documents.
(Apple does not document whether `requestAuthorization()` re-prompts on its
own; this makes the contract true by construction rather than by assumption.)

Rejects `UNAVAILABLE` on a device where `WorkoutScheduler.isSupported` is
false.

## Returns

`Promise`\<[`WorkoutPlanAuthorizationState`](../type-aliases/WorkoutPlanAuthorizationState.md)\>
