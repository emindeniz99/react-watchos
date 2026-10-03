[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / WorkoutSummary

# Interface: WorkoutSummary

Defined in: [js/src/health.ts:311](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L311)

One saved workout — the fields a "recent workouts" row actually renders.

Deliberately not everything an `HKWorkout` carries: `metadata` (free-form
and app-private), `device`, `sourceRevision`, `workoutEvents` (pause/lap
markers — a detail screen's problem, not a list's), `HKWorkoutActivity`
multisport segments and the full `allStatistics` map are all left off. They
are what a *detail* view would want, and each one is a wire cost paid by
every row of every list; a later method can add them without moving this
shape.

## Properties

### activeEnergyKcal

> **activeEnergyKcal**: `number` \| `null`

Defined in: [js/src/health.ts:329](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L329)

Active energy burned, kcal. `null` means the workout recorded **no**
 energy samples — a manually logged session, say — not that it burned
 zero. See [queryWorkoutHistory](../functions/queryWorkoutHistory.md) for the two other things `null`
 covers.

***

### activityType?

> `optional` **activityType?**: [`WorkoutActivityType`](../type-aliases/WorkoutActivityType.md)

Defined in: [js/src/health.ts:324](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L324)

Omitted when this binary's vocabulary has no name for the stored
 activity — the list contains workouts other apps saved, so naming the
 wrong one would be worse than naming none.

***

### distanceMeters

> **distanceMeters**: `number` \| `null`

Defined in: [js/src/health.ts:340](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L340)

Distance, metres, read from the quantity type the workout's *activity*
 records under — `distanceCycling` for a ride, `distanceSwimming` for a
 swim, `distanceWheelchair` for the wheelchair paces,
 `distanceDownhillSnowSports` for skiing and snowboarding, walking/running
 for everything else. `null` means no distance samples at all, which is
 what an indoor yoga session honestly looks like — not 0.

 Rowing, paddling, cross-country skiing and skating record under types
 Apple introduced at watchOS 11, above this package's floor, so they read
 as walking/running and will usually be `null`.

***

### durationMs

> **durationMs**: `number`

Defined in: [js/src/health.ts:320](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L320)

Time the workout was *running*, in ms. Not `endMs - startMs`: HealthKit's
 `duration` excludes paused time, and this is the number a row shows.

***

### endMs

> **endMs**: `number`

Defined in: [js/src/health.ts:317](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L317)

***

### id

> **id**: `string`

Defined in: [js/src/health.ts:315](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L315)

The saved `HKWorkout`'s UUID — a stable list key, and the same id
 `WorkoutState.endedWorkoutId` reports for a workout this app just
 finished, so the two can be matched rather than guessed at.

***

### startMs

> **startMs**: `number`

Defined in: [js/src/health.ts:316](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L316)
