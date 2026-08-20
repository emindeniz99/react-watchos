[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / HealthStatisticsQuery

# Interface: HealthStatisticsQuery

Defined in: [js/src/health.ts:127](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L127)

Request for [queryHealthStatistics](../functions/queryHealthStatistics.md).

## Properties

### endMs

> **endMs**: `number`

Defined in: [js/src/health.ts:133](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L133)

Absolute ms since epoch (exclusive). Must be after `startMs`.

***

### startMs

> **startMs**: `number`

Defined in: [js/src/health.ts:131](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L131)

Absolute ms since epoch (inclusive).

***

### statistic

> **statistic**: `"sum"` \| `"average"` \| `"min"` \| `"max"` \| `"mostRecent"`

Defined in: [js/src/health.ts:129](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L129)

***

### type

> **type**: [`HealthQuantityType`](../type-aliases/HealthQuantityType.md)

Defined in: [js/src/health.ts:128](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L128)
