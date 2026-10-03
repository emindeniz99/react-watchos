[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / ScheduledWorkoutSummary

# Interface: ScheduledWorkoutSummary

Defined in: [js/src/workoutPlans.ts:203](https://github.com/emindeniz99/react-watchos/blob/main/js/src/workoutPlans.ts#L203)

One plan the Workout app is holding.

## Properties

### activityType?

> `optional` **activityType?**: [`WorkoutActivityType`](../type-aliases/WorkoutActivityType.md)

Defined in: [js/src/workoutPlans.ts:223](https://github.com/emindeniz99/react-watchos/blob/main/js/src/workoutPlans.ts#L223)

Absent when this binary's vocabulary has no name for the stored activity
 — omitted rather than reported as the wrong workout.

***

### atMs

> **atMs**: `number`

Defined in: [js/src/workoutPlans.ts:217](https://github.com/emindeniz99/react-watchos/blob/main/js/src/workoutPlans.ts#L217)

When it is scheduled, ms since epoch. **Minute granularity**: the
scheduler keys on year/month/day/hour/minute, so a plan scheduled at
`…:30.500` lists as `…:30.000`.

***

### complete

> **complete**: `boolean`

Defined in: [js/src/workoutPlans.ts:220](https://github.com/emindeniz99/react-watchos/blob/main/js/src/workoutPlans.ts#L220)

Set by the **Workout app** when the user finishes it. Nothing in this API
 writes it — reading it is how you learn a plan was done.

***

### id

> **id**: `string`

Defined in: [js/src/workoutPlans.ts:211](https://github.com/emindeniz99/react-watchos/blob/main/js/src/workoutPlans.ts#L211)

The plan's UUID — the one you passed, or the one native minted, always in
RFC 9562 **canonical lower-case** (the form `crypto.randomUUID()` emits).
Native parses your id to a UUID value and keeps no spelling, so an
upper-case id you passed comes back lower-cased: compare
case-insensitively if you may have sent one.
