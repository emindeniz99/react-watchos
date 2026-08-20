[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / HealthStatistic

# Type Alias: HealthStatistic

> **HealthStatistic** = `HealthStatisticsRequest`\[`"statistic"`\]

Defined in: [js/src/health.ts:70](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L70)

Which aggregate to compute. Derived from the wire request so the union can't
drift from the schema — which matters more than usual here:
`HKStatisticsOptions` is a bitmask whose cumulative and discrete halves are
mutually exclusive per type, and the wrong pairing **throws** natively. So
which of the two families a type belongs to is the one thing to look up
before calling — HealthKit decides it, not this package:

- **Cumulative** — `"sum"` only. Things that accumulate over a window:
  `stepCount`, `flightsClimbed`, `distanceWalkingRunning`,
  `activeEnergyBurned`, `basalEnergyBurned`, `appleExerciseTime`,
  `appleStandTime`.
- **Discrete** — `"average" | "min" | "max" | "mostRecent"` only. Things
  that are *measured* at an instant: `heartRate`, `restingHeartRate`,
  `walkingHeartRateAverage`, `heartRateVariabilitySDNN`, `respiratoryRate`,
  `oxygenSaturation`, `vo2Max`.

An illegal pairing rejects `INVALID_REQUEST` *before* the query runs, with a
message naming the rule.
