[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / HealthSamplesQuery

# Interface: HealthSamplesQuery

Defined in: [js/src/health.ts:87](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L87)

Request for [queryHealthSamples](../functions/queryHealthSamples.md).

## Properties

### endMs

> **endMs**: `number`

Defined in: [js/src/health.ts:90](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L90)

***

### limit?

> `optional` **limit?**: `number`

Defined in: [js/src/health.ts:93](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L93)

Cap on samples returned. Hard ceiling 1000 — every sample crosses the
 bridge as JSON on a memory-tight watch.

***

### startMs

> **startMs**: `number`

Defined in: [js/src/health.ts:89](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L89)

***

### type

> **type**: [`HealthQuantityType`](../type-aliases/HealthQuantityType.md)

Defined in: [js/src/health.ts:88](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L88)
