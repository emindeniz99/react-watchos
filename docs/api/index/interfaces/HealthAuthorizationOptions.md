[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / HealthAuthorizationOptions

# Interface: HealthAuthorizationOptions

Defined in: [js/src/health.ts:83](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L83)

Options for [requestHealthAuthorization](../functions/requestHealthAuthorization.md).

## Properties

### read

> **read**: [`HealthQuantityType`](../type-aliases/HealthQuantityType.md)[]

Defined in: [js/src/health.ts:85](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L85)

Quantity types to ask for.

***

### sleep?

> `optional` **sleep?**: `boolean`

Defined in: [js/src/health.ts:88](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L88)

Also ask for sleep analysis — a HealthKit *category* type, so it isn't
 expressible in `read`. Required before [querySleepSamples](../functions/querySleepSamples.md).

***

### workoutHistory?

> `optional` **workoutHistory?**: `boolean`

Defined in: [js/src/health.ts:94](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L94)

Also ask for saved workouts (`HKObjectType.workoutType()`) — neither a
 quantity nor a category type, so it isn't expressible in `read` either.
 Required before [queryWorkoutHistory](../functions/queryWorkoutHistory.md). Nothing to do with the
 `workouts` *feature*, which authorizes *recording* a workout: this only
 widens the read sheet by the saved-workouts row.
