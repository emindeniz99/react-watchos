[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / SleepSample

# Interface: SleepSample

Defined in: [js/src/health.ts:127](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L127)

One staged sleep interval. Sleep is not a numeric series, so it has its own
 shape rather than a `value: 3` plus a magic mapping every caller owns.

## Properties

### endMs

> **endMs**: `number`

Defined in: [js/src/health.ts:129](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L129)

***

### stage

> **stage**: `"inBed"` \| `"awake"` \| `"asleepCore"` \| `"asleepDeep"` \| `"asleepREM"` \| `"asleepUnspecified"`

Defined in: [js/src/health.ts:130](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L130)

***

### startMs

> **startMs**: `number`

Defined in: [js/src/health.ts:128](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L128)
