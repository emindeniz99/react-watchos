[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / ActivitySummary

# Interface: ActivitySummary

Defined in: [js/src/health.ts:259](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L259)

One day's Activity rings: three value/goal pairs, plus the day they are for.

The goals are why this exists. No `HKQuantityType` exposes one — reading
`appleExerciseTime` tells you someone exercised 23 minutes and not whether
that closed their ring — so an arc could not be drawn from this package at
all before this read.

Every goal here is a **divisor** — an arc is `value / goal` — and two things
can stop one being usable: the two watchOS 9 goals cross as `null` when
HealthKit has none, and any goal may legitimately be `0` (HealthKit documents
no floor). Treat both the same way — there is no ring to draw — rather than
substituting Apple's defaults or dividing into an `Infinity`/`NaN` arc that
renders as a full or blank ring.

Deliberately not carried: `isPaused` (watchOS 11, above this package's floor)
and the "activity moved to a paused state" story around it.

## Properties

### activeEnergyGoalKcal

> **activeEnergyGoalKcal**: `number`

Defined in: [js/src/health.ts:277](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L277)

The move ring's goal, kcal. Always present — HealthKit reports it on
 every summary whatever the `moveMode` is, which also means it is *not*
 the goal the user was scored against on an `"appleMoveTime"` day: that is
 [ActivitySummary.moveTimeGoalMinutes](#movetimegoalminutes). May be `0`; see the
 interface doc.

***

### activeEnergyKcal

> **activeEnergyKcal**: `number`

Defined in: [js/src/health.ts:271](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L271)

Move ring, energy spelling: active energy burned, kcal.

***

### date

> **date**: `string`

Defined in: [js/src/health.ts:267](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L267)

The day this row is *for*, `"YYYY-MM-DD"` — a calendar day as the user
 perceives it, never an instant. Every row names its own day because
 HealthKit returns **no row** for a day it has no summary for (a watch left
 on the charger), so a seven-day ask can resolve five rows and the array
 position is not "the nth day you asked for". Rows arrive **oldest day
 first**, so plotting them left to right needs no sort — but index them by
 this field, not by position.

***

### exerciseGoalMinutes

> **exerciseGoalMinutes**: `number` \| `null`

Defined in: [js/src/health.ts:291](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L291)

The exercise goal, minutes, or `null` when HealthKit has none for that day
 (the goal became per-day in watchOS 9). `null` is **not** 30: a ring with
 no goal cannot be drawn, and a substituted default draws one the user was
 never scored against. Render it as "no goal", not as a full ring.

***

### exerciseMinutes

> **exerciseMinutes**: `number`

Defined in: [js/src/health.ts:286](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L286)

Exercise ring: exercise minutes. Minutes, not milliseconds — this is a
 counter the watch increments and a goal set in whole minutes, not a
 stopwatch duration like [WorkoutSummary.durationMs](WorkoutSummary.md#durationms).

***

### moveMode

> **moveMode**: `"appleMoveTime"` \| `"activeEnergy"`

Defined in: [js/src/health.ts:269](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L269)

Which pair below is the move ring — see [ActivityMoveMode](../type-aliases/ActivityMoveMode.md).

***

### moveTimeGoalMinutes

> **moveTimeGoalMinutes**: `number`

Defined in: [js/src/health.ts:282](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L282)

The move-time goal, minutes.

***

### moveTimeMinutes

> **moveTimeMinutes**: `number`

Defined in: [js/src/health.ts:280](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L280)

Move ring, *time* spelling: Apple move time, minutes. Reported whichever
 mode is active, so the day a user switches modes needs no second query.

***

### standHours

> **standHours**: `number`

Defined in: [js/src/health.ts:294](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L294)

Stand ring: stand hours, a **count** of hours (the ring reads "10 of
 12"), not a duration.

***

### standHoursGoal

> **standHoursGoal**: `number` \| `null`

Defined in: [js/src/health.ts:297](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L297)

The stand goal, in hours, or `null` — same watchOS 9 optionality and the
 same rule as [ActivitySummary.exerciseGoalMinutes](#exercisegoalminutes).
