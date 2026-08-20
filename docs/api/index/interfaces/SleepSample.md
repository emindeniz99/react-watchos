[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / SleepSample

# Interface: SleepSample

Defined in: [js/src/health.ts:215](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L215)

One staged sleep interval. Sleep is not a numeric series, so it has its own
 shape rather than a `value: 3` plus a magic mapping every caller owns.

## Properties

### endMs

> **endMs**: `number`

Defined in: [js/src/health.ts:217](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L217)

***

### stage

> **stage**: `"inBed"` \| `"awake"` \| `"asleepCore"` \| `"asleepDeep"` \| `"asleepREM"` \| `"asleepUnspecified"`

Defined in: [js/src/health.ts:218](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L218)

***

### startMs

> **startMs**: `number`

Defined in: [js/src/health.ts:216](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L216)
