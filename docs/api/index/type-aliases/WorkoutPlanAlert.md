[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / WorkoutPlanAlert

# Type Alias: WorkoutPlanAlert

> **WorkoutPlanAlert** = \{ `kind`: `"heartRateRange"`; `lowerBpm`: `number`; `upperBpm`: `number`; \} \| \{ `kind`: `"heartRateZone"`; `zone`: `number`; \} \| \{ `kind`: `"speedRange"`; `lowerMetersPerSecond`: `number`; `metric?`: `"current"` \| `"average"`; `upperMetersPerSecond`: `number`; \} \| \{ `kind`: `"speedThreshold"`; `metersPerSecond`: `number`; `metric?`: `"current"` \| `"average"`; \} \| \{ `kind`: `"cadenceRange"`; `lowerCountPerMinute`: `number`; `upperCountPerMinute`: `number`; \} \| \{ `countPerMinute`: `number`; `kind`: `"cadenceThreshold"`; \} \| \{ `kind`: `"powerRange"`; `lowerWatts`: `number`; `upperWatts`: `number`; \} \| \{ `kind`: `"powerThreshold"`; `watts`: `number`; \} \| \{ `kind`: `"powerZone"`; `zone`: `number`; \}

Defined in: [js/src/workoutPlans.ts:108](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/workoutPlans.ts#L108)

The in-workout alert a step fires on. **One per step** — Apple's
`WorkoutStep.alert` is a single optional, not an array.

Two things worth knowing before shipping one:

- **Which alerts are legal depends on the activity *and* the location, and
  Apple documents the matrix nowhere.** Indoor running, for instance, permits
  heart-rate targets but not pace. Every alert is checked natively with
  `CustomWorkout.supportsAlert` before the plan is built, so an illegal one
  rejects `INVALID_REQUEST` naming the path
  (`plan.blocks[2].steps[0].alert: …`) instead of silently vanishing.
- **Alerts fire more often than users expect.** For cycling power in
  particular the watch averages over ~3 seconds, so a rider holding target
  still gets warnings every 10–15 s. That is Apple's behavior, not this
  library's — budget for it in your UI copy.

`metric` (current vs average) is available on the **speed** alerts only:
Apple takes it at watchOS 10.0 there and at 10.4 for power, and this package
is deliberately `@available`-free.
