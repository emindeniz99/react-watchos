[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / WorkoutPlanStep

# Interface: WorkoutPlanStep

Defined in: [js/src/workoutPlans.ts:134](https://github.com/emindeniz99/react-watchos/blob/main/js/src/workoutPlans.ts#L134)

A warmup / cooldown step: an optional goal and at most one alert.

## Extended by

- [`WorkoutPlanIntervalStep`](WorkoutPlanIntervalStep.md)

## Properties

### alert?

> `optional` **alert?**: [`WorkoutPlanAlert`](../type-aliases/WorkoutPlanAlert.md)

Defined in: [js/src/workoutPlans.ts:137](https://github.com/emindeniz99/react-watchos/blob/main/js/src/workoutPlans.ts#L137)

***

### goal?

> `optional` **goal?**: [`WorkoutPlanGoal`](../type-aliases/WorkoutPlanGoal.md)

Defined in: [js/src/workoutPlans.ts:136](https://github.com/emindeniz99/react-watchos/blob/main/js/src/workoutPlans.ts#L136)

Omitted means Apple's `.open` — run until the user taps next.
