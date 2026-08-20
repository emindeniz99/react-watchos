[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / queryHealthStatistics

# Function: queryHealthStatistics()

> **queryHealthStatistics**(`request`): `Promise`\<[`HealthStatisticsResult`](../interfaces/HealthStatisticsResult.md)\>

Defined in: [js/src/health.ts:367](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L367)

One aggregate (`HKStatisticsQueryDescriptor`) over `[startMs, endMs)` — e.g.
total steps today, or average heart rate during a run.

Rejects `INVALID_REQUEST` when `statistic` is illegal for `type` (see
[HealthStatistic](../type-aliases/HealthStatistic.md)) or the window is inverted. Resolves
`{ value: null }` when HealthKit has nothing to report — which, again, is
*not* distinguishable from a denied read.

For a chart, use [queryHealthDailyStatistics](queryHealthDailyStatistics.md) instead of calling this
once per day — it is one HealthKit query rather than seven.

## Parameters

### request

[`HealthStatisticsQuery`](../interfaces/HealthStatisticsQuery.md)

## Returns

`Promise`\<[`HealthStatisticsResult`](../interfaces/HealthStatisticsResult.md)\>
