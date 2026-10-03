[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / removeScheduledWorkoutPlan

# Function: removeScheduledWorkoutPlan()

> **removeScheduledWorkoutPlan**(`id`, `at`): `Promise`\<`boolean`\>

Defined in: [js/src/workoutPlans.ts:454](https://github.com/emindeniz99/react-watchos/blob/main/js/src/workoutPlans.ts#L454)

Removes one scheduled plan by the `(id, at)` pair it was scheduled with, and
resolves **whether it was there**.

An id that isn't scheduled resolves `false` rather than rejecting: a stale UI
removing an already-completed plan is normal, not an error. A malformed
(non-UUID) id still rejects `INVALID_REQUEST`. Native resolves the real plan
object out of the scheduler, so you never re-send a whole composition to
delete one, and the removal is read back before it settles.

## Parameters

### id

`string`

### at

`number` \| `Date`

## Returns

`Promise`\<`boolean`\>
