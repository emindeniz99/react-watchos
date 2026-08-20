[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / HealthSamplesQuery

# Interface: HealthSamplesQuery

Defined in: [js/src/health.ts:137](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L137)

Request for [queryHealthSamples](../functions/queryHealthSamples.md).

## Properties

### endMs

> **endMs**: `number`

Defined in: [js/src/health.ts:140](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L140)

***

### limit?

> `optional` **limit?**: `number`

Defined in: [js/src/health.ts:143](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L143)

Cap on samples returned. Hard ceiling 1000 — every sample crosses the
 bridge as JSON on a memory-tight watch.

***

### startMs

> **startMs**: `number`

Defined in: [js/src/health.ts:139](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L139)

***

### type

> **type**: [`HealthQuantityType`](../type-aliases/HealthQuantityType.md)

Defined in: [js/src/health.ts:138](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L138)
