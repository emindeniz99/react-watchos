[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / HealthSamplesQuery

# Interface: HealthSamplesQuery

Defined in: [js/src/health.ts:86](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/health.ts#L86)

Request for [queryHealthSamples](../functions/queryHealthSamples.md).

## Properties

### endMs

> **endMs**: `number`

Defined in: [js/src/health.ts:89](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/health.ts#L89)

***

### limit?

> `optional` **limit?**: `number`

Defined in: [js/src/health.ts:92](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/health.ts#L92)

Cap on samples returned. Hard ceiling 1000 — every sample crosses the
 bridge as JSON on a memory-tight watch.

***

### startMs

> **startMs**: `number`

Defined in: [js/src/health.ts:88](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/health.ts#L88)

***

### type

> **type**: [`HealthQuantityType`](../type-aliases/HealthQuantityType.md)

Defined in: [js/src/health.ts:87](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/health.ts#L87)
