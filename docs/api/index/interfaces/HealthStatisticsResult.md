[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / HealthStatisticsResult

# Interface: HealthStatisticsResult

Defined in: [js/src/health.ts:104](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L104)

One aggregate over a window.

## Properties

### endMs

> **endMs**: `number`

Defined in: [js/src/health.ts:113](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L113)

***

### startMs

> **startMs**: `number`

Defined in: [js/src/health.ts:112](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L112)

***

### unit

> **unit**: `string`

Defined in: [js/src/health.ts:111](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L111)

The unit `value` is in, fixed natively per type: `"count"` (steps),
 `"kcal"`, `"m"`, `"count/min"` (bpm), `"fraction"` (SpO2, **0…1**, not
 0…100). Reported so a chart can label its axis.

***

### value

> **value**: `number` \| `null`

Defined in: [js/src/health.ts:107](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L107)

`null` when HealthKit returned no statistic for the window. Not
 distinguishable from a denied read — see the module doc.
