[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / HealthSample

# Interface: HealthSample

Defined in: [js/src/health.ts:218](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L218)

One raw quantity sample.

## Properties

### endMs

> **endMs**: `number`

Defined in: [js/src/health.ts:227](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L227)

***

### id

> **id**: `string`

Defined in: [js/src/health.ts:225](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L225)

The sample's HealthKit UUID — a stable list key, and the identity a
 live-stream deletion names: when the user deletes a sample in the Health
 app while [startHealthUpdates](../functions/startHealthUpdates.md) is streaming, `onDeleted` reports
 this id, so a screen keeping its own buffer can retract exactly the row
 it added. Present on query rows and live rows alike — a deletion can
 name a sample that arrived either way.

***

### startMs

> **startMs**: `number`

Defined in: [js/src/health.ts:226](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L226)

***

### unit

> **unit**: `string`

Defined in: [js/src/health.ts:230](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L230)

Same per-type unit as [HealthStatisticsResult.unit](HealthStatisticsResult.md#unit).

***

### value

> **value**: `number`

Defined in: [js/src/health.ts:228](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L228)
