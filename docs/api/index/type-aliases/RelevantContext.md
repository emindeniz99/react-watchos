[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / RelevantContext

# Type Alias: RelevantContext

> **RelevantContext** = \{ `date`: `number` \| `Date`; `dateKind?`: [`RelevantDateKind`](RelevantDateKind.md); `kind`: `"date"`; \} \| \{ `dateKind?`: [`RelevantDateKind`](RelevantDateKind.md); `from`: `number` \| `Date`; `kind`: `"dateRange"`; `to`: `number` \| `Date`; \} \| \{ `kind`: `"location"`; `latitude`: `number`; `longitude`: `number`; `radius?`: `number`; \} \| \{ `category`: [`PoiCategory`](PoiCategory.md); `kind`: `"poi"`; \} \| \{ `kind`: `"inferredLocation"`; `place`: [`InferredLocation`](InferredLocation.md); \} \| \{ `condition`: [`FitnessCondition`](FitnessCondition.md); `kind`: `"fitness"`; \} \| \{ `condition`: [`SleepCondition`](SleepCondition.md); `kind`: `"sleep"`; \} \| \{ `condition`: [`HeadphonesCondition`](HeadphonesCondition.md); `kind`: `"headphones"`; \}

Defined in: [js/src/widgets.ts:215](https://github.com/emindeniz99/react-watchos/blob/main/js/src/widgets.ts#L215)

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

## Union Members

### Type Literal

\{ `date`: `number` \| `Date`; `dateKind?`: [`RelevantDateKind`](RelevantDateKind.md); `kind`: `"date"`; \}

Surface near an exact moment.

***

### Type Literal

\{ `dateKind?`: [`RelevantDateKind`](RelevantDateKind.md); `from`: `number` \| `Date`; `kind`: `"dateRange"`; `to`: `number` \| `Date`; \}

Surface across a closed date range (watchOS 26.0 — `date(range:kind:)` has
no sub-26 overload, so this clue is dropped entirely below it).

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
