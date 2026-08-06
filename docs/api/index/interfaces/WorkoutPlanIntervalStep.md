[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / WorkoutPlanIntervalStep

# Interface: WorkoutPlanIntervalStep

Defined in: [js/src/workoutPlans.ts:140](https://github.com/emindeniz99/react-watchos/blob/main/js/src/workoutPlans.ts#L140)

A step inside an interval block, which additionally says what it is for.

## Extends

- [`WorkoutPlanStep`](WorkoutPlanStep.md)

## Properties

### alert?

> `optional` **alert?**: [`WorkoutPlanAlert`](../type-aliases/WorkoutPlanAlert.md)

Defined in: [js/src/workoutPlans.ts:136](https://github.com/emindeniz99/react-watchos/blob/main/js/src/workoutPlans.ts#L136)

#### Inherited from

[`WorkoutPlanStep`](WorkoutPlanStep.md).[`alert`](WorkoutPlanStep.md#alert)

***

### goal?

> `optional` **goal?**: [`WorkoutPlanGoal`](../type-aliases/WorkoutPlanGoal.md)

Defined in: [js/src/workoutPlans.ts:135](https://github.com/emindeniz99/react-watchos/blob/main/js/src/workoutPlans.ts#L135)

Omitted means Apple's `.open` — run until the user taps next.

#### Inherited from

[`WorkoutPlanStep`](WorkoutPlanStep.md).[`goal`](WorkoutPlanStep.md#goal)

***

### purpose

> **purpose**: `"work"` \| `"recovery"`

Defined in: [js/src/workoutPlans.ts:141](https://github.com/emindeniz99/react-watchos/blob/main/js/src/workoutPlans.ts#L141)
