[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / HealthUpdateOptions

# Interface: HealthUpdateOptions

Defined in: [js/src/health.ts:641](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L641)

Options for [startHealthUpdates](../functions/startHealthUpdates.md).

## Properties

### minIntervalMs?

> `optional` **minIntervalMs?**: `number`

Defined in: [js/src/health.ts:658](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L658)

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

***

### onDeleted?

> `optional` **onDeleted?**: [`HealthDeletionHandler`](../type-aliases/HealthDeletionHandler.md)

Defined in: [js/src/health.ts:677](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L677)

Called when samples are **deleted** from HealthKit while the stream is up
— the user removing an entry in the Health app is the case this exists
for. Omit it and deletions are simply not delivered; the sample handler's
contract does not change either way.

Deletions ride the same native batch as additions (same floor, same
merge), so ordering is preserved: for a batch carrying both, the sample
handler runs first and `onDeleted` second — apply adds, then retract.
Unlike `minIntervalMs` this is **per subscriber**, not first-wins: it is
a JS routing choice, not a native knob on the shared query.

A deletion is *not* a `value` correction — HealthKit samples are
immutable, so an edit in the Health app arrives as a deletion plus a new
sample. And nothing is replayed: a deletion that happened while the app
was backgrounded is not delivered on return, the same rule the samples
live by — re-read on foreground if the number on screen must be right.
