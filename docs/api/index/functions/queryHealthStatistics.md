[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / queryHealthStatistics

# Function: queryHealthStatistics()

> **queryHealthStatistics**(`request`): `Promise`\<[`HealthStatisticsResult`](../interfaces/HealthStatisticsResult.md)\>

Defined in: [js/src/health.ts:171](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/health.ts#L171)

One aggregate (`HKStatisticsQueryDescriptor`) over `[startMs, endMs)` — e.g.
total steps today, or average heart rate during a run.

Rejects `INVALID_REQUEST` when `statistic` is illegal for `type` (see
[HealthStatistic](../type-aliases/HealthStatistic.md)) or the window is inverted. Resolves
`{ value: null }` when HealthKit has nothing to report — which, again, is
*not* distinguishable from a denied read.

For per-day buckets, call this once per day:
`HKStatisticsCollectionQueryDescriptor` is a recorded follow-up, not v1.

## Parameters

### request

[`HealthStatisticsQuery`](../interfaces/HealthStatisticsQuery.md)

## Returns

`Promise`\<[`HealthStatisticsResult`](../interfaces/HealthStatisticsResult.md)\>
