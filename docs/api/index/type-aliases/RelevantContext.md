[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / RelevantContext

# Type Alias: RelevantContext

> **RelevantContext** = \{ `date`: `number` \| `Date`; `dateKind?`: [`RelevantDateKind`](RelevantDateKind.md); `kind`: `"date"`; \} \| \{ `dateKind?`: [`RelevantDateKind`](RelevantDateKind.md); `from`: `number` \| `Date`; `kind`: `"dateRange"`; `to`: `number` \| `Date`; \} \| \{ `kind`: `"location"`; `latitude`: `number`; `longitude`: `number`; `radius?`: `number`; \} \| \{ `category`: [`PoiCategory`](PoiCategory.md); `kind`: `"poi"`; \} \| \{ `kind`: `"inferredLocation"`; `place`: [`InferredLocation`](InferredLocation.md); \} \| \{ `condition`: [`FitnessCondition`](FitnessCondition.md); `kind`: `"fitness"`; \} \| \{ `condition`: [`SleepCondition`](SleepCondition.md); `kind`: `"sleep"`; \} \| \{ `condition`: [`HeadphonesCondition`](HeadphonesCondition.md); `kind`: `"headphones"`; \}

Defined in: [js/src/widgets.ts:258](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L258)

A Smart Stack **predictive** clue: when/where the system should surface this
widget at all. Distinct from [EntryRelevance](../interfaces/EntryRelevance.md), which ranks a widget the
stack is already showing.

Clues are metadata for the on-device ranker — publishing one costs a few
bytes at render time and zero wakeups, CPU or radio at surface time, which is
why this is the one relevance surface worth widening on a battery-first
library.

A tagged union, not the old positional `{date?, latitude?, …}` bag: the
RelevanceKit surface has eight clue families that share no fields, and a
discriminant is the only shape that can carry a POI category, an inferred
place, or a fitness/sleep/headphones condition at all.

Availability is per-arm and handled natively: `poi`, `dateRange` and any
explicit `dateKind` need watchOS 26.0 and are dropped below it (`@available`
gate in `reactRelevantContext`); the other six families are watchOS 10.0 —
the package's own floor — so they work on every supported watch.

**Permissions — a clue only has an effect if the app already holds the
matching grant.** Publishing one costs nothing and requests nothing: the
system evaluates clues out of process, so an ungranted clue is silently
ignored (Apple: "if contextual … information isn't available to the system,
clues to signal relevance don't have an effect" — no error, the widget just
never surfaces for it). What each family needs, per Apple's docs
(developer.apple.com docs JSON, RelevanceKit `RelevantContext`, read
2026-08-22):

- `location`, `poi`, `inferredLocation` — the app must "request a person's
  permission to access their location with the When in Use or Always access
  level" (each location clue's page states this verbatim), i.e. hold
  CoreLocation authorization; use `getCurrentLocation` or the
  `location` sensor stream to trigger the prompt, and supply
  `NSLocationWhenInUseUsageDescription` (the plugin emits it under
  `workouts: true`; otherwise pass it via the plugin's `infoPlist` option).
  Apple's clue pages further point to "Accessing location information in
  widgets", which documents the widget-side half for widgets that READ
  location: `NSWidgetWantsLocation` in the widget extension's Info.plist and
  the user extending the app's grant to the widget. A relevance clue reads
  no location in-process, and Apple does not state that clue evaluation
  needs that key — recorded as unverified rather than assumed either way
  (Smart Stack surfacing is device-only, see docs/status.md).
- `fitness` — HealthKit grants, per condition: `workoutActive` "requires
  usage of HKWorkoutType" — `requestHealthAuthorization({ workoutHistory:
  true })` puts that exact type on the sheet (an app recording workouts via
  `startWorkout` holds it too). `activityRingsIncomplete` requires the
  `appleExerciseTime`, `appleMoveTime` and `appleStandTime` QUANTITY types —
  `read: ["appleExerciseTime", "appleStandTime", "appleMoveTime"]` puts all
  three on the sheet (`appleMoveTime` joined the vocabulary 2026-08-22 to
  close exactly this gap). The `activitySummaries` flag is NOT a substitute:
  it asks for the summary type, which Apple treats as a different row than
  these three.
- `sleep` — the HealthKit `sleepAnalysis` read:
  `requestHealthAuthorization({ sleep: true })` (plugin `healthKit: true`).
- `date`, `dateRange`, `headphones` — nothing. Apple notes the headphones
  clue grants the app no fitness data in return.

RelevanceKit is watchOS-only by Apple's design: Smart Stacks exist on
iOS/iPadOS too, but "functionality provided by RelevanceKit API is only
available in watchOS. Calling its API on other platforms doesn't have any
effect."

## Union Members

### Type Literal

\{ `date`: `number` \| `Date`; `dateKind?`: [`RelevantDateKind`](RelevantDateKind.md); `kind`: `"date"`; \}

Surface near an exact moment.

***

### Type Literal

\{ `dateKind?`: [`RelevantDateKind`](RelevantDateKind.md); `from`: `number` \| `Date`; `kind`: `"dateRange"`; `to`: `number` \| `Date`; \}

Surface across a closed date range (watchOS 26.0 — `date(range:kind:)` has
no sub-26 overload, so this clue is dropped entirely below it).

Also the wire spelling for RelevanceKit's `date(interval:kind:)` (watchOS
26.0): a `DateInterval` is start + duration, the same signal as from/to,
so it is deliberately NOT a ninth kind — one wire spelling per signal, or
the payload gains a way to disagree with itself.

***

### Type Literal

\{ `kind`: `"location"`; `latitude`: `number`; `longitude`: `number`; `radius?`: `number`; \}

Surface inside a geofence (radius in meters, default 100).

***

### Type Literal

\{ `category`: [`PoiCategory`](PoiCategory.md); `kind`: `"poi"`; \}

Surface near any point of interest of this category (watchOS 26.0).

***

### Type Literal

\{ `kind`: `"inferredLocation"`; `place`: [`InferredLocation`](InferredLocation.md); \}

Surface at a place the system infers, with no coordinates of our own.

***

### Type Literal

\{ `condition`: [`FitnessCondition`](FitnessCondition.md); `kind`: `"fitness"`; \}

***

### Type Literal

\{ `condition`: [`SleepCondition`](SleepCondition.md); `kind`: `"sleep"`; \}

***

### Type Literal

\{ `condition`: [`HeadphonesCondition`](HeadphonesCondition.md); `kind`: `"headphones"`; \}
