[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / HealthStatistic

# Type Alias: HealthStatistic

> **HealthStatistic** = `HealthStatisticsRequest`\[`"statistic"`\]

Defined in: [js/src/health.ts:54](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/health.ts#L54)

Which aggregate to compute. Derived from the wire request so the union can't
drift from the schema — which matters more than usual here:
`HKStatisticsOptions` is a bitmask whose cumulative and discrete halves are
mutually exclusive per type, and the wrong pairing **throws** natively.
`"sum"` is legal only for a cumulative type (`stepCount`,
`activeEnergyBurned`, `distanceWalkingRunning`); `"average" | "min" | "max" |
"mostRecent"` only for a discrete one (`heartRate`, `oxygenSaturation`). An
illegal pairing rejects `INVALID_REQUEST` *before* the query runs.
