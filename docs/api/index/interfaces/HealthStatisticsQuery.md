[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / HealthStatisticsQuery

# Interface: HealthStatisticsQuery

Defined in: [js/src/health.ts:76](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/health.ts#L76)

Request for [queryHealthStatistics](../functions/queryHealthStatistics.md).

## Properties

### endMs

> **endMs**: `number`

Defined in: [js/src/health.ts:82](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/health.ts#L82)

Absolute ms since epoch (exclusive). Must be after `startMs`.

***

### startMs

> **startMs**: `number`

Defined in: [js/src/health.ts:80](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/health.ts#L80)

Absolute ms since epoch (inclusive).

***

### statistic

> **statistic**: `"sum"` \| `"average"` \| `"min"` \| `"max"` \| `"mostRecent"`

Defined in: [js/src/health.ts:78](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/health.ts#L78)

***

### type

> **type**: [`HealthQuantityType`](../type-aliases/HealthQuantityType.md)

Defined in: [js/src/health.ts:77](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/health.ts#L77)
