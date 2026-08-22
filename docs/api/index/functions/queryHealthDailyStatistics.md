[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / queryHealthDailyStatistics

# Function: queryHealthDailyStatistics()

> **queryHealthDailyStatistics**(`request`): `Promise`\<[`HealthStatisticsResult`](../interfaces/HealthStatisticsResult.md)[]\>

Defined in: [js/src/health.ts:418](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L418)

The same aggregate, computed **once per day** across the window
(`HKStatisticsCollectionQueryDescriptor`) — "steps per day for the last
week" in one call.

Prefer this over a loop of [queryHealthStatistics](queryHealthStatistics.md): seven calls are
seven HealthKit query round trips, and on a watch that is a battery cost,
not a style preference. The request is identical, and each bucket is exactly
a [HealthStatisticsResult](../interfaces/HealthStatisticsResult.md) over its own day — same `value`, same
`unit`, its own `startMs`/`endMs`.

- **Buckets are contiguous, not sparse.** A day with no samples comes back
  as `value: null`, never as a missing entry, so `results.length` is the
  number of days you asked for and index *n* is day *n*.
- **A "day" starts at your `startMs`.** Buckets are anchored there and step
  one calendar day at a time, so pass local midnight (`d.setHours(0,0,0,0)`)
  to get the days a user would recognise — JS is where the time zone is.
- Rejects `INVALID_REQUEST` for the same illegal `statistic`/`type` pairing
  as the scalar query, and additionally when the window spans more than 1000
  days. That is a refusal rather than a truncation on purpose: a silently
  shortened series is a chart that lies about its range.

`null` still means "denied, or no data, or outside the window you were
granted" — see the module doc.

## Parameters

### request

[`HealthStatisticsQuery`](../interfaces/HealthStatisticsQuery.md)

## Returns

`Promise`\<[`HealthStatisticsResult`](../interfaces/HealthStatisticsResult.md)[]\>
