[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / HealthUpdate

# Interface: HealthUpdate

Defined in: [js/src/health.ts:585](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L585)

One batch of samples that just landed in HealthKit, as
 [startHealthUpdates](../functions/startHealthUpdates.md) delivers it.

## Properties

### latest

> **latest**: [`HealthSample`](HealthSample.md)

Defined in: [js/src/health.ts:616](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L616)

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

Defined in: [js/src/health.ts:605](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L605)

The new samples, **oldest first** (sorted natively — HealthKit promises
`addedSamples` no order), each identical in shape and unit to a
[queryHealthSamples](../functions/queryHealthSamples.md) row. Never empty: an update with nothing added
is not delivered to this handler — reach for [latest](#latest) rather than
indexing, which under this package's strictness needs a `!` the wrapper
has already earned.

**Additions only, by shape.** The anchored query also reports objects
DELETED from HealthKit, and those arrive on
[HealthUpdateOptions.onDeleted](HealthUpdateOptions.md#ondeleted) rather than here — a retraction is
not a sample, and folding it in would cost this handler the `latest`
guarantee for an event most screens ignore. A subscriber that keeps its
own buffer passes `onDeleted` and removes rows by [HealthSample.id](HealthSample.md#id);
one that renders a total re-reads it with [queryHealthStatistics](../functions/queryHealthStatistics.md).

***

### type

> **type**: [`HealthQuantityType`](../type-aliases/HealthQuantityType.md)

Defined in: [js/src/health.ts:588](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L588)

The type these samples are for — the same value passed to
 [startHealthUpdates](../functions/startHealthUpdates.md), so one handler can serve two subscriptions.
