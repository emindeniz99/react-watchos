[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / HealthStatisticsQuery

# Interface: HealthStatisticsQuery

Defined in: [js/src/health.ts:98](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L98)

Request for [queryHealthStatistics](../functions/queryHealthStatistics.md).

## Properties

### endMs

> **endMs**: `number`

Defined in: [js/src/health.ts:104](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L104)

Absolute ms since epoch (exclusive). Must be after `startMs`.

***

### startMs

> **startMs**: `number`

Defined in: [js/src/health.ts:102](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L102)

Absolute ms since epoch (inclusive).

***

### statistic

> **statistic**: `"sum"` \| `"average"` \| `"min"` \| `"max"` \| `"mostRecent"`

Defined in: [js/src/health.ts:100](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L100)

***

### type

> **type**: [`HealthQuantityType`](../type-aliases/HealthQuantityType.md)

Defined in: [js/src/health.ts:99](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L99)
