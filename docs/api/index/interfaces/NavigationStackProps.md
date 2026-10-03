[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / NavigationStackProps

# Interface: NavigationStackProps

Defined in: [js/src/components.ts:319](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L319)

## Extends

- `A11yProps`

## Properties

### accessibilityHint?

> `optional` **accessibilityHint?**: `string`

Defined in: [js/src/components.ts:76](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L76)

#### Inherited from

`A11yProps.accessibilityHint`

***

### accessibilityLabel?

> `optional` **accessibilityLabel?**: `string`

Defined in: [js/src/components.ts:75](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L75)

#### Inherited from

`A11yProps.accessibilityLabel`

***

### children?

> `optional` **children?**: `ReactNode`

Defined in: [js/src/components.ts:335](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L335)

***

### onPathChange?

> `optional` **onPathChange?**: (`path`) => `void`

Defined in: [js/src/components.ts:334](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L334)

Fired when native back/link gestures propose a new stack path. In
controlled mode, fold it into `path` SYNCHRONOUSLY — setState inside the
handler is enough (the dispatch flushes it). Navigation is a confirmed
transaction (ARCH-09): a proposal the handler doesn't fold reads as
declined, and native won't navigate. Pops are notifications — native has
already popped — but must be folded the same way.

#### Parameters

##### path

`string`[]

#### Returns

`void`

***

### path?

> `optional` **path?**: `string`[]

Defined in: [js/src/components.ts:325](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L325)

Controlled native stack path. Root is represented by [] and pushed
routes are stable path strings such as ["/hydration"].

***

### title?

> `optional` **title?**: `string`

Defined in: [js/src/components.ts:320](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L320)
