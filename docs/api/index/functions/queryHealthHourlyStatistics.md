[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / queryHealthHourlyStatistics

# Function: queryHealthHourlyStatistics()

> **queryHealthHourlyStatistics**(`request`): `Promise`\<[`HealthStatisticsResult`](../interfaces/HealthStatisticsResult.md)[]\>

Defined in: [js/src/health.ts:445](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L445)

The same aggregate, computed **once per hour** across the window — "steps
per hour today" in one call, the chart the daily buckets are too coarse
for. Identical contract to [queryHealthDailyStatistics](queryHealthDailyStatistics.md) (same
request, same result rows, contiguous buckets with `value: null` for an
empty hour) at a different granularity — the method name *is* the
granularity, which is why there is no bucket-size option on either.

- **Buckets are anchored at your `startMs`** and step exactly 3 600 000 ms:
  unlike a calendar *day*, an hour is the same length everywhere, so bucket
  *n* always spans `[startMs + n·3600000, startMs + (n+1)·3600000)`. Pass a
  local hour boundary (e.g. local midnight) to get hours a user recognises.
- **On a DST day, a local "day" is 23 or 25 of these buckets** — that is
  the honest count, not an off-by-one. Label the chart from each bucket's
  own `startMs`, never by assuming 24 per day.
- Rejects `INVALID_REQUEST` for the same illegal `statistic`/`type` pairing
  as its siblings, and when the window spans more than 1000 **hours** —
  the family's one 1000-bucket ceiling, which here is about 41 days. A
  wider chart wants [queryHealthDailyStatistics](queryHealthDailyStatistics.md); a refusal beats a
  silently truncated series.

`null` still means "denied, or no data, or outside the window you were
granted" — see the module doc.

## Parameters

### request

[`HealthStatisticsQuery`](../interfaces/HealthStatisticsQuery.md)

## Returns

`Promise`\<[`HealthStatisticsResult`](../interfaces/HealthStatisticsResult.md)[]\>
