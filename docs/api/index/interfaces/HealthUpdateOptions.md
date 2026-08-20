[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / HealthUpdateOptions

# Interface: HealthUpdateOptions

Defined in: [js/src/health.ts:581](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L581)

Options for [startHealthUpdates](../functions/startHealthUpdates.md).

## Properties

### minIntervalMs?

> `optional` **minIntervalMs?**: `number`

Defined in: [js/src/health.ts:598](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L598)

Minimum gap between two pushes for this type, in ms. Default 1000, maximum
60000 (a wider floor rejects `INVALID_REQUEST`).

Not a sampling rate — HealthKit decides when a sample exists — and not a
filter: batches that arrive inside the floor are **held and merged**, so
they ride the next push together rather than the older one being dropped to
make room (which is what `workout.metrics` does, and can, because a metric
is level state). It is a **battery and render knob**: every push crosses the
bridge and commits a React render synchronously, so raising it really does
cut the number of pushes — N held batches cost one — at the price of up to
`minIntervalMs` of staleness.

Only the **first** subscriber's value takes effect — the native stream is
shared, exactly like `startSensor`'s options.
