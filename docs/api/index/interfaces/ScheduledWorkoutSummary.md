[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / ScheduledWorkoutSummary

# Interface: ScheduledWorkoutSummary

Defined in: [js/src/workoutPlans.ts:202](https://github.com/emindeniz99/react-watchos/blob/main/js/src/workoutPlans.ts#L202)

One plan the Workout app is holding.

## Properties

### activityType?

> `optional` **activityType?**: [`WorkoutActivityType`](../type-aliases/WorkoutActivityType.md)

Defined in: [js/src/workoutPlans.ts:222](https://github.com/emindeniz99/react-watchos/blob/main/js/src/workoutPlans.ts#L222)

Absent when this binary's vocabulary has no name for the stored activity
 — omitted rather than reported as the wrong workout.

***

### atMs

> **atMs**: `number`

Defined in: [js/src/workoutPlans.ts:216](https://github.com/emindeniz99/react-watchos/blob/main/js/src/workoutPlans.ts#L216)

When it is scheduled, ms since epoch. **Minute granularity**: the
scheduler keys on year/month/day/hour/minute, so a plan scheduled at
`…:30.500` lists as `…:30.000`.

***

### complete

> **complete**: `boolean`

Defined in: [js/src/workoutPlans.ts:219](https://github.com/emindeniz99/react-watchos/blob/main/js/src/workoutPlans.ts#L219)

Set by the **Workout app** when the user finishes it. Nothing in this API
 writes it — reading it is how you learn a plan was done.

***

### id

> **id**: `string`

Defined in: [js/src/workoutPlans.ts:210](https://github.com/emindeniz99/react-watchos/blob/main/js/src/workoutPlans.ts#L210)

The plan's UUID — the one you passed, or the one native minted, always in
RFC 9562 **canonical lower-case** (the form `crypto.randomUUID()` emits).
Native parses your id to a UUID value and keeps no spelling, so an
upper-case id you passed comes back lower-cased: compare
case-insensitively if you may have sent one.
