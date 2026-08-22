[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / HealthSample

# Interface: HealthSample

Defined in: [js/src/health.ts:212](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L212)

One raw quantity sample.

## Properties

### endMs

> **endMs**: `number`

Defined in: [js/src/health.ts:221](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L221)

***

### id

> **id**: `string`

Defined in: [js/src/health.ts:219](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L219)

The sample's HealthKit UUID — a stable list key, and the identity a
 live-stream deletion names: when the user deletes a sample in the Health
 app while [startHealthUpdates](../functions/startHealthUpdates.md) is streaming, `onDeleted` reports
 this id, so a screen keeping its own buffer can retract exactly the row
 it added. Present on query rows and live rows alike — a deletion can
 name a sample that arrived either way.

***

### startMs

> **startMs**: `number`

Defined in: [js/src/health.ts:220](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L220)

***

### unit

> **unit**: `string`

Defined in: [js/src/health.ts:224](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L224)

Same per-type unit as [HealthStatisticsResult.unit](HealthStatisticsResult.md#unit).

***

### value

> **value**: `number`

Defined in: [js/src/health.ts:222](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L222)
