[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / WorkoutPlanCommon

# Interface: WorkoutPlanCommon

Defined in: [js/src/workoutPlans.ts:155](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/workoutPlans.ts#L155)

The fields every plan kind carries, whatever its `kind`. Exported because
 every arm of [WorkoutPlanSpec](../type-aliases/WorkoutPlanSpec.md) extends it, so a consumer writing
 `function label(plan: WorkoutPlanCommon)` should not have to restate it.

## Properties

### activityType

> **activityType**: [`WorkoutActivityType`](../type-aliases/WorkoutActivityType.md)

Defined in: [js/src/workoutPlans.ts:166](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/workoutPlans.ts#L166)

***

### id?

> `optional` **id?**: `string`

Defined in: [js/src/workoutPlans.ts:165](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/workoutPlans.ts#L165)

A **UUID**, and the identity `scheduleWorkoutPlan` /
`removeScheduledWorkoutPlan` / `listScheduledWorkoutPlans` all key on.
Omit it and native mints one, reported back in the summary. A non-UUID
string rejects `INVALID_REQUEST` rather than being silently replaced —
a substitution would make removal a no-op you could never see. Whatever
you pass, the summary spells it back in canonical lower-case; see
[ScheduledWorkoutSummary.id](ScheduledWorkoutSummary.md#id).

***

### location?

> `optional` **location?**: `"indoor"` \| `"outdoor"`

Defined in: [js/src/workoutPlans.ts:168](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/workoutPlans.ts#L168)

Omitted maps to WorkoutKit's own "unknown" default.
