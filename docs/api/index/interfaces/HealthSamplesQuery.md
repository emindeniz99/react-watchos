[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / HealthSamplesQuery

# Interface: HealthSamplesQuery

Defined in: [js/src/health.ts:96](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L96)

Request for [queryHealthSamples](../functions/queryHealthSamples.md).

## Properties

### endMs

> **endMs**: `number`

Defined in: [js/src/health.ts:99](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L99)

***

### limit?

> `optional` **limit?**: `number`

Defined in: [js/src/health.ts:102](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L102)

Cap on samples returned. Hard ceiling 1000 — every sample crosses the
 bridge as JSON on a memory-tight watch.

***

### startMs

> **startMs**: `number`

Defined in: [js/src/health.ts:98](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L98)

***

### type

> **type**: [`HealthQuantityType`](../type-aliases/HealthQuantityType.md)

Defined in: [js/src/health.ts:97](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L97)
