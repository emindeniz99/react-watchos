[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / HealthSamplesQuery

# Interface: HealthSamplesQuery

Defined in: [js/src/health.ts:108](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L108)

Request for [queryHealthSamples](../functions/queryHealthSamples.md).

## Properties

### endMs

> **endMs**: `number`

Defined in: [js/src/health.ts:111](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L111)

***

### limit?

> `optional` **limit?**: `number`

Defined in: [js/src/health.ts:114](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L114)

Cap on samples returned. Hard ceiling 1000 — every sample crosses the
 bridge as JSON on a memory-tight watch.

***

### startMs

> **startMs**: `number`

Defined in: [js/src/health.ts:110](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L110)

***

### type

> **type**: [`HealthQuantityType`](../type-aliases/HealthQuantityType.md)

Defined in: [js/src/health.ts:109](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L109)
