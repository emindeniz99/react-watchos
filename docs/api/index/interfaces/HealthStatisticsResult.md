[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / HealthStatisticsResult

# Interface: HealthStatisticsResult

Defined in: [js/src/health.ts:139](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L139)

One aggregate over a window.

## Properties

### endMs

> **endMs**: `number`

Defined in: [js/src/health.ts:159](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L159)

***

### startMs

> **startMs**: `number`

Defined in: [js/src/health.ts:158](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L158)

***

### unit

> **unit**: `string`

Defined in: [js/src/health.ts:157](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L157)

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

Defined in: [js/src/health.ts:142](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L142)

`null` when HealthKit returned no statistic for the window. Not
 distinguishable from a denied read — see the module doc.
