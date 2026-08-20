[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / startHealthUpdates

# Function: startHealthUpdates()

> **startHealthUpdates**(`type`, `handler`, `options?`): [`HealthUpdatesSubscription`](../interfaces/HealthUpdatesSubscription.md)

Defined in: [js/src/health.ts:699](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L699)

Live HealthKit updates for one quantity type: `handler` is called as new
samples land, so a screen showing today's steps or the current heart rate
updates itself instead of polling.

```ts
useEffect(
  () => startHealthUpdates("heartRate", (u) => setBpm(u.latest.value)).stop,
  [],
);
```

Backed by an `HKAnchoredObjectQueryDescriptor` (watchOS 8.5). Needs the type
in `requestHealthAuthorization({ read: [...] })` — and asks for it itself if
you did not, so a missing grant is a prompt rather than a stream that never
fires.

**NEW samples only.** A subscriber gets what lands from *now on*, never a
backlog: history is [queryHealthSamples](queryHealthSamples.md)'s job, and replaying it here
would hand a screen a thousand-row first push. A **second** subscriber to the
same type joins the running query and likewise sees the next sample, not the
last one — the event is edge-triggered, so nothing is replayed to a late
listener. Read the current value once with [queryHealthStatistics](queryHealthStatistics.md) and
let this keep it fresh.

**Foreground only.** The query is stopped when the app backgrounds and
re-armed when it returns — this package ships no background-delivery
entitlement, so an armed query would deliver nothing while the app is away
and wake it for nothing when it came back. Samples saved while backgrounded
are **not** replayed on return, so re-read the number you display on the same
foreground.

**Not a heart-rate monitor for a workout.** `startHeartRate` runs a real
`HKWorkoutSession` + `HKLiveWorkoutBuilder`: it samples at ~1 Hz, keeps the
app alive, and occupies the one workout slot watchOS allows a process. This
runs no session and needs no background mode; it reports heart-rate samples
as HealthKit saves them, which off a workout is every few minutes. During a
workout, reach for the session; on a screen showing today's numbers, reach
for this.

Every subscriber gets its own subscription even when two pass the *same*
function: one call, one `stop`, one delivery.

## Parameters

### type

[`HealthQuantityType`](../type-aliases/HealthQuantityType.md)

### handler

[`HealthUpdateHandler`](../type-aliases/HealthUpdateHandler.md)

### options?

[`HealthUpdateOptions`](../interfaces/HealthUpdateOptions.md)

## Returns

[`HealthUpdatesSubscription`](../interfaces/HealthUpdatesSubscription.md)
