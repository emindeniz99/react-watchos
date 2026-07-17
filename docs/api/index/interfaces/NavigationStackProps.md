[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / NavigationStackProps

# Interface: NavigationStackProps

Defined in: [js/src/components.ts:266](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L266)

## Extends

- `A11yProps`

## Properties

### accessibilityHint?

> `optional` **accessibilityHint?**: `string`

Defined in: [js/src/components.ts:53](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L53)

#### Inherited from

`A11yProps.accessibilityHint`

***

### accessibilityLabel?

> `optional` **accessibilityLabel?**: `string`

Defined in: [js/src/components.ts:52](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L52)

#### Inherited from

`A11yProps.accessibilityLabel`

***

### children?

> `optional` **children?**: `ReactNode`

Defined in: [js/src/components.ts:282](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L282)

***

### onPathChange?

> `optional` **onPathChange?**: (`path`) => `void`

Defined in: [js/src/components.ts:281](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L281)

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

Defined in: [js/src/components.ts:272](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L272)

Controlled native stack path. Root is represented by [] and pushed
routes are stable path strings such as ["/hydration"].

***

### title?

> `optional` **title?**: `string`

Defined in: [js/src/components.ts:267](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L267)
