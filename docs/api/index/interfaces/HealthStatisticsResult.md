[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / HealthStatisticsResult

# Interface: HealthStatisticsResult

Defined in: [js/src/health.ts:181](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L181)

One aggregate over a window.

## Properties

### endMs

> **endMs**: `number`

Defined in: [js/src/health.ts:201](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L201)

***

### startMs

> **startMs**: `number`

Defined in: [js/src/health.ts:200](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L200)

***

### unit

> **unit**: `string`

Defined in: [js/src/health.ts:199](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L199)

The unit `value` is in, fixed natively per type — never chosen by the
 caller — and reported so a chart can label its axis:

 - `"count"` — `stepCount`, `flightsClimbed`
 - `"count/min"` — every rate: `heartRate`, `restingHeartRate`,
   `walkingHeartRateAverage`, `respiratoryRate`
 - `"m"` — `distanceWalkingRunning`
 - `"kcal"` — `activeEnergyBurned`, `basalEnergyBurned`
 - `"min"` — `appleExerciseTime`, `appleStandTime`
 - `"ms"` — `heartRateVariabilitySDNN`, **milliseconds**: 45, not 0.045
 - `"fraction"` — `oxygenSaturation`, **0…1**, not 0…100
 - `"ml/kg/min"` — `vo2Max`. Apple states the watch estimates the 14-60
   range, so a value near 0.04 is a slipped unit prefix, not a reading

***

### value

> **value**: `number` \| `null`

Defined in: [js/src/health.ts:184](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L184)

`null` when HealthKit returned no statistic for the window. Not
 distinguishable from a denied read — see the module doc.
