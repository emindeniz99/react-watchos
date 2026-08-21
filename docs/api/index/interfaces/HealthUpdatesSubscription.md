[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / HealthUpdatesSubscription

# Interface: HealthUpdatesSubscription

Defined in: [js/src/health.ts:612](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L612)

What [startHealthUpdates](../functions/startHealthUpdates.md) returns: a cleanup, plus the promise the
fallible *start* settles on.

Two members rather than one, because both halves are load-bearing and neither
can carry the other. A bare `Promise<Unsubscribe>` would make the React case
— the only case — an async dance whose cleanup can run before the promise
resolves; a bare `Unsubscribe` (the `startSensor` shape) would leave a failed
start with nowhere to go, which is the wart this API deliberately does not
repeat.

## Properties

### started

> **started**: `Promise`\<`void`\>

Defined in: [js/src/health.ts:630](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L630)

Settles when native has the query **armed** — or, if the app is in the
background, queued to arm on the next foreground (see the foreground-only
note on [startHealthUpdates](../functions/startHealthUpdates.md)) — and rejects when it could not be:
`UNAVAILABLE` on a watch without HealthKit, `INVALID_REQUEST` for a bad
`minIntervalMs`. Awaiting it is optional — a rejection is also logged, so a
caller who ignores it still gets a diagnostic instead of a screen stuck on
"—" — but awaiting is what lets a UI say *why* there is no data.

It does **not** report a denied read grant: HealthKit answers an
authorization request the same way whether the user allowed or refused, by
design, so a refused type is indistinguishable from one with no samples yet.

A start that is cancelled by its own `stop()` before it finishes (React
StrictMode's mount/unmount/remount does this every time) **resolves**:
nothing failed, the subscriber simply left.

***

### stop

> **stop**: [`Unsubscribe`](../type-aliases/Unsubscribe.md)

Defined in: [js/src/health.ts:635](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L635)

Drops this subscriber and, when it is the last one for the type, stops the
native query. Idempotent, and safe to call before [started](#started) settles.
