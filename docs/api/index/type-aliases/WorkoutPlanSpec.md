[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / WorkoutPlanSpec

# Type Alias: WorkoutPlanSpec

> **WorkoutPlanSpec** = [`WorkoutPlanCommon`](../interfaces/WorkoutPlanCommon.md) & `object` \| [`WorkoutPlanCommon`](../interfaces/WorkoutPlanCommon.md) & `object` \| [`WorkoutPlanCommon`](../interfaces/WorkoutPlanCommon.md) & `object`

Defined in: [js/src/workoutPlans.ts:185](https://github.com/emindeniz99/react-watchos/blob/main/js/src/workoutPlans.ts#L185)

A workout composition. Three kinds, matching the three WorkoutKit types this
package builds:

- `custom` — interval blocks, optional warmup/cooldown. The reason to use
  WorkoutKit at all; needs **at least one block** (an unstructured plan is a
  `singleGoal`).
- `singleGoal` — one goal, no structure. The only kind where an `energy`
  goal is legal.
- `pacer` — "5 km in 25:00": a distance and the time to cover it in.

Multisport (`SwimBikeRunWorkout`) is deliberately not built — no surveyed
consumer ships it, and adding it is one more `kind`, additive.
