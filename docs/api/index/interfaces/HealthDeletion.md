[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / HealthDeletion

# Interface: HealthDeletion

Defined in: [js/src/health.ts:624](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L624)

Samples RETRACTED from HealthKit while a live stream is up, as
 [HealthUpdateOptions.onDeleted](HealthUpdateOptions.md#ondeleted) delivers them.

## Properties

### ids

> **ids**: `string`[]

Defined in: [js/src/health.ts:634](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L634)

The deleted samples' [HealthSample.id](HealthSample.md#id)s. Never empty — a batch
 with nothing deleted is not delivered here at all. Ids can name samples
 that arrived on this stream *or* rows read earlier with
 [queryHealthSamples](../functions/queryHealthSamples.md): HealthKit's identity is the same either way,
 which is the whole reason the row shape carries one. An id you never saw
 (another app's sample outside your windows) is safe to ignore.

***

### type

> **type**: [`HealthQuantityType`](../type-aliases/HealthQuantityType.md)

Defined in: [js/src/health.ts:627](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L627)

The type the stream is for — the same value passed to
 [startHealthUpdates](../functions/startHealthUpdates.md), so one handler can serve two subscriptions.
