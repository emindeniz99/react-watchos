[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / HealthUpdate

# Interface: HealthUpdate

Defined in: [js/src/health.ts:545](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L545)

One batch of samples that just landed in HealthKit, as
 [startHealthUpdates](../functions/startHealthUpdates.md) delivers it.

## Properties

### latest

> **latest**: [`HealthSample`](HealthSample.md)

Defined in: [js/src/health.ts:574](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L574)

The newest sample in this batch — `samples` is never empty, so this always
exists, which is the point: it is the whole answer for a "current heart
rate" screen without an index or a non-null assertion.

For a "today's steps" screen it is **not** the answer: HealthKit stores
steps as many small samples, so the running total comes from
[queryHealthStatistics](../functions/queryHealthStatistics.md) and this stream is what tells you when to
re-read it.

***

### samples

> **samples**: [`HealthSample`](HealthSample.md)[]

Defined in: [js/src/health.ts:563](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L563)

The new samples, **oldest first** (sorted natively — HealthKit promises
`addedSamples` no order), each identical in shape and unit to a
[queryHealthSamples](../functions/queryHealthSamples.md) row. Never empty: an update with nothing added
is not pushed at all — reach for [latest](#latest) rather than indexing, which
under this package's strictness needs a `!` the wrapper has already earned.

**Additions only.** The anchored query also reports objects DELETED from
HealthKit, and this stream drops them: a wire row is `{startMs, endMs,
value, unit}` with no sample identity, so a subscriber could not tell which
of its rows a deletion retracted. A value the user then deletes in the
Health app is therefore not withdrawn here — re-read with
[queryHealthSamples](../functions/queryHealthSamples.md) or [queryHealthStatistics](../functions/queryHealthStatistics.md) if that matters.

***

### type

> **type**: [`HealthQuantityType`](../type-aliases/HealthQuantityType.md)

Defined in: [js/src/health.ts:548](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L548)

The type these samples are for — the same value passed to
 [startHealthUpdates](../functions/startHealthUpdates.md), so one handler can serve two subscriptions.
