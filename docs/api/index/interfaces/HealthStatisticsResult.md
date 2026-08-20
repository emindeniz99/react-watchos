[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / HealthStatisticsResult

# Interface: HealthStatisticsResult

Defined in: [js/src/health.ts:105](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L105)

One aggregate over a window.

## Properties

### endMs

> **endMs**: `number`

Defined in: [js/src/health.ts:115](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L115)

***

### startMs

> **startMs**: `number`

Defined in: [js/src/health.ts:114](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L114)

***

### unit

> **unit**: `string`

Defined in: [js/src/health.ts:113](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L113)

The unit `value` is in, fixed natively per type: `"count"` (steps),
 `"kcal"`, `"m"`, `"count/min"` (bpm — heart rate and resting heart rate),
 `"ms"` (HRV SDNN, **milliseconds**: 45, not 0.045), `"fraction"` (SpO2,
 **0…1**, not 0…100). Reported so a chart can label its axis.

***

### value

> **value**: `number` \| `null`

Defined in: [js/src/health.ts:108](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L108)

`null` when HealthKit returned no statistic for the window. Not
 distinguishable from a denied read — see the module doc.
