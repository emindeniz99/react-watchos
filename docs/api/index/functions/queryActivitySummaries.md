[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / queryActivitySummaries

# Function: queryActivitySummaries()

> **queryActivitySummaries**(`request`): `Promise`\<[`ActivitySummary`](../interfaces/ActivitySummary.md)[]\>

Defined in: [js/src/health.ts:567](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L567)

The Activity **rings** for a range of days — move, exercise and stand, each
with the goal it is scored against, one row per day
(`HKActivitySummaryQueryDescriptor`).

This is the read a rings screen is made of: three arcs are three value/goal
pairs, and the goals live nowhere else in HealthKit's read surface. It is
also what feeds a rings *complication*, but indirectly — every health read is
watch-app-only, so the **app** calls this and publishes the answer to the
widget timeline (`publishWidgets`); a complication that invoked it itself
would just get an error.

**Days, not timestamps.** HealthKit identifies an activity summary by the
calendar day *as the user perceived it* — a day that, in Apple's own words,
"may be longer or shorter than 24 hours (for example, if the user traveled
across time zones)". No millisecond means that day on its own, so the request
and every row carry `"YYYY-MM-DD"` and nothing converts between the two. Both
ends are **inclusive**; `startDate === endDate` is a single day. A malformed
date, an `endDate` before `startDate`, or a range over 1000 days rejects
`INVALID_REQUEST` with a message naming the rule.

**Producing a day string is the one thing to get right.** It must be the
user's *local* calendar day, so build it from the local getters:

```ts
const pad = (n: number) => String(n).padStart(2, "0");
const day = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
```

**Not** `d.toISOString().slice(0, 10)`, the one-liner this shape invites:
that is UTC, so for part of every day it names a different day than the
user's watch is on. It is also the one form of the off-by-one nothing here
can refuse — a UTC day string is a perfectly valid day, just not the one the
caller meant.

**A day with no summary is absent**, not a zero row: the user's watch was off
the wrist, or the day is in the future. Rows arrive **oldest day first**
(HealthKit promises no order, so the native side sorts), but a seven-day ask
can still resolve five rows — read [ActivitySummary.date](../interfaces/ActivitySummary.md#date), never the
array index.

Needs `requestHealthAuthorization({ read: [], activitySummaries: true })`
first. It asks for exactly one row in the sheet — unlike
[queryWorkoutHistory](queryWorkoutHistory.md), a summary is a single object HealthKit hands
over whole, so no quantity types ride along.

An empty array still means "denied, or no data, or outside the window you
were granted"; see the module doc.

## Parameters

### request

[`ActivitySummariesQuery`](../interfaces/ActivitySummariesQuery.md)

## Returns

`Promise`\<[`ActivitySummary`](../interfaces/ActivitySummary.md)[]\>
