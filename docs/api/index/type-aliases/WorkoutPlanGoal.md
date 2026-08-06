[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / WorkoutPlanGoal

# Type Alias: WorkoutPlanGoal

> **WorkoutPlanGoal** = \{ `kind`: `"open"`; \} \| \{ `kind`: `"distance"`; `meters`: `number`; \} \| \{ `kind`: `"time"`; `seconds`: `number`; \} \| \{ `kilocalories`: `number`; `kind`: `"energy"`; \}

Defined in: [js/src/workoutPlans.ts:81](https://github.com/emindeniz99/react-watchos/blob/main/js/src/workoutPlans.ts#L81)

What a step (or a single-goal workout) is trying to reach.

`energy` is legal **only** on a `singleGoal` plan — Apple's
`CustomWorkout.supportsGoal(.energy, …)` returns false for every activity and
location, by design. A custom workout asking for one rejects
`INVALID_REQUEST` naming that.
