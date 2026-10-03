[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / queryWorkoutHistory

# Function: queryWorkoutHistory()

> **queryWorkoutHistory**(`request`): `Promise`\<[`WorkoutSummary`](../interfaces/WorkoutSummary.md)[]\>

Defined in: [js/src/health.ts:511](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L511)

The workouts already **saved** in `[startMs, endMs)`, newest first — a
"your last five runs" screen, as opposed to [getWorkoutState](getWorkoutState.md) (the
live one) or `listScheduledWorkoutPlans` (future ones).

A workout matches when it **overlaps** the window — it ended at or after
`startMs` and started before `endMs` — which is HealthKit's default matching
and not the `[startMs, endMs)` rule the reads above describe. The difference
only shows up here, because only a workout is long enough for it to matter:
a hike that began at 23:10 and ended at 00:40 is in *both* days' lists, and
since rows sort by start time it lands last in the later one.

Needs `requestHealthAuthorization({ read: [], workoutHistory: true })` first
— saved workouts are their own HealthKit object type and can't ride the
`read` list. That one flag asks for the energy and distance types too, not
just the workout: a workout's totals are computed from the samples recorded
*during* it, each of which is authorized on its own, so the sheet shows
those rows as well.

The list includes workouts **other apps saved**, which is the whole point of
a history read and also why `activityType` can be missing: an activity this
package's vocabulary excludes is omitted rather than mislabelled.

`activeEnergyKcal` and `distanceMeters` are `null` when the workout recorded
no samples of that kind — never `0` standing in for "didn't measure". Two
cases beyond "didn't measure" land there too: an app that saved only a
*total* with no per-sample data behind it (the un-deprecated read computes
these from the samples, so it cannot see such a total), and a type the user
declined in the sheet. An empty array still means "denied, or no data, or
outside the window you were granted"; see the module doc.

## Parameters

### request

[`WorkoutHistoryQuery`](../interfaces/WorkoutHistoryQuery.md)

## Returns

`Promise`\<[`WorkoutSummary`](../interfaces/WorkoutSummary.md)[]\>
