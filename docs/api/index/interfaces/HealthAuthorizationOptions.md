[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / HealthAuthorizationOptions

# Interface: HealthAuthorizationOptions

Defined in: [js/src/health.ts:108](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L108)

Options for [requestHealthAuthorization](../functions/requestHealthAuthorization.md).

## Properties

### activitySummaries?

> `optional` **activitySummaries?**: `boolean`

Defined in: [js/src/health.ts:130](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L130)

Also ask for the Activity rings (`HKObjectType.activitySummaryType()`) —
 a third read type that is neither a quantity nor a category, so it isn't
 expressible in `read` either. Required before
 [queryActivitySummaries](../functions/queryActivitySummaries.md).

 Asking for it does **not** imply the `appleExerciseTime` /
 `appleStandTime` quantity rows, and it doesn't need them: a summary is one
 object carrying all three rings and their goals. Apple allows reading
 summaries but never *sharing* them, which is already all this package
 asks for.

***

### read

> **read**: [`HealthQuantityType`](../type-aliases/HealthQuantityType.md)[]

Defined in: [js/src/health.ts:110](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L110)

Quantity types to ask for.

***

### sleep?

> `optional` **sleep?**: `boolean`

Defined in: [js/src/health.ts:113](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L113)

Also ask for sleep analysis — a HealthKit *category* type, so it isn't
 expressible in `read`. Required before [querySleepSamples](../functions/querySleepSamples.md).

***

### workoutHistory?

> `optional` **workoutHistory?**: `boolean`

Defined in: [js/src/health.ts:119](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L119)

Also ask for saved workouts (`HKObjectType.workoutType()`) — neither a
 quantity nor a category type, so it isn't expressible in `read` either.
 Required before [queryWorkoutHistory](../functions/queryWorkoutHistory.md). Nothing to do with the
 `workouts` *feature*, which authorizes *recording* a workout: this only
 widens the read sheet by the saved-workouts row.
