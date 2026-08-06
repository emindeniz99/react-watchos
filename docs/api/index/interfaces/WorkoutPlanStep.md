[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / WorkoutPlanStep

# Interface: WorkoutPlanStep

Defined in: [js/src/workoutPlans.ts:133](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/workoutPlans.ts#L133)

A warmup / cooldown step: an optional goal and at most one alert.

## Extended by

- [`WorkoutPlanIntervalStep`](WorkoutPlanIntervalStep.md)

## Properties

### alert?

> `optional` **alert?**: [`WorkoutPlanAlert`](../type-aliases/WorkoutPlanAlert.md)

Defined in: [js/src/workoutPlans.ts:136](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/workoutPlans.ts#L136)

***

### goal?

> `optional` **goal?**: [`WorkoutPlanGoal`](../type-aliases/WorkoutPlanGoal.md)

Defined in: [js/src/workoutPlans.ts:135](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/workoutPlans.ts#L135)

Omitted means Apple's `.open` — run until the user taps next.
