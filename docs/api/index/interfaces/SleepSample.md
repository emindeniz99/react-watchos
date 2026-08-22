[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / SleepSample

# Interface: SleepSample

Defined in: [js/src/health.ts:235](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L235)

One staged sleep interval. Sleep is not a numeric series, so it has its own
 shape rather than a `value: 3` plus a magic mapping every caller owns.

## Properties

### endMs

> **endMs**: `number`

Defined in: [js/src/health.ts:237](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L237)

***

### stage

> **stage**: `"inBed"` \| `"awake"` \| `"asleepCore"` \| `"asleepDeep"` \| `"asleepREM"` \| `"asleepUnspecified"`

Defined in: [js/src/health.ts:238](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L238)

***

### startMs

> **startMs**: `number`

Defined in: [js/src/health.ts:236](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L236)
