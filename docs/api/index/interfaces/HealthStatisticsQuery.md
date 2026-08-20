[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / HealthStatisticsQuery

# Interface: HealthStatisticsQuery

Defined in: [js/src/health.ts:86](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L86)

Request for [queryHealthStatistics](../functions/queryHealthStatistics.md).

## Properties

### endMs

> **endMs**: `number`

Defined in: [js/src/health.ts:92](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L92)

Absolute ms since epoch (exclusive). Must be after `startMs`.

***

### startMs

> **startMs**: `number`

Defined in: [js/src/health.ts:90](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L90)

Absolute ms since epoch (inclusive).

***

### statistic

> **statistic**: `"sum"` \| `"average"` \| `"min"` \| `"max"` \| `"mostRecent"`

Defined in: [js/src/health.ts:88](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L88)

***

### type

> **type**: [`HealthQuantityType`](../type-aliases/HealthQuantityType.md)

Defined in: [js/src/health.ts:87](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L87)
