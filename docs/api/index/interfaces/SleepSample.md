[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / SleepSample

# Interface: SleepSample

Defined in: [js/src/health.ts:229](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L229)

One staged sleep interval. Sleep is not a numeric series, so it has its own
 shape rather than a `value: 3` plus a magic mapping every caller owns.

## Properties

### endMs

> **endMs**: `number`

Defined in: [js/src/health.ts:231](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L231)

***

### stage

> **stage**: `"inBed"` \| `"awake"` \| `"asleepCore"` \| `"asleepDeep"` \| `"asleepREM"` \| `"asleepUnspecified"`

Defined in: [js/src/health.ts:232](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L232)

***

### startMs

> **startMs**: `number`

Defined in: [js/src/health.ts:230](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L230)
