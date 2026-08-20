[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / HealthStatisticsQuery

# Interface: HealthStatisticsQuery

Defined in: [js/src/health.ts:134](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L134)

Request for [queryHealthStatistics](../functions/queryHealthStatistics.md).

## Properties

### endMs

> **endMs**: `number`

Defined in: [js/src/health.ts:140](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L140)

Absolute ms since epoch (exclusive). Must be after `startMs`.

***

### startMs

> **startMs**: `number`

Defined in: [js/src/health.ts:138](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L138)

Absolute ms since epoch (inclusive).

***

### statistic

> **statistic**: `"sum"` \| `"average"` \| `"min"` \| `"max"` \| `"mostRecent"`

Defined in: [js/src/health.ts:136](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L136)

***

### type

> **type**: [`HealthQuantityType`](../type-aliases/HealthQuantityType.md)

Defined in: [js/src/health.ts:135](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L135)
