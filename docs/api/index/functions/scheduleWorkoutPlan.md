[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / scheduleWorkoutPlan

# Function: scheduleWorkoutPlan()

> **scheduleWorkoutPlan**(`plan`, `at`): `Promise`\<[`ScheduledWorkoutSummary`](../interfaces/ScheduledWorkoutSummary.md)\>

Defined in: [js/src/workoutPlans.ts:404](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/workoutPlans.ts#L404)

Schedules `plan` at `at` and resolves the summary the scheduler actually
holds — **read back after writing**, never assumed.

- The instant is truncated to the **minute** (WorkoutKit keys on
  year/month/day/hour/minute), which is what makes
  [removeScheduledWorkoutPlan](removeScheduledWorkoutPlan.md) match by construction.
- The device's own quota (`maxAllowedScheduledWorkoutCount`, read at
  runtime — never a hardcoded 15) is checked first; over it, this rejects
  `INVALID_REQUEST` naming the numbers.
- Every goal and alert is put through Apple's `supports*` checks before the
  plan is built, so an illegal combination rejects `INVALID_REQUEST` naming
  the failing path.
- If the scheduler stores nothing, this rejects `UNAVAILABLE` saying so
  rather than resolving a success that did not happen.

The user sees a scheduled plan at the top of the Workout app on the day it
is due (Apple shows a ±7-day window).

## Parameters

### plan

[`WorkoutPlanSpec`](../type-aliases/WorkoutPlanSpec.md)

### at

`number` \| `Date`

## Returns

`Promise`\<[`ScheduledWorkoutSummary`](../interfaces/ScheduledWorkoutSummary.md)\>
