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

Defined in: [js/src/components.ts:275](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L275)

***

### onPathChange?

> `optional` **onPathChange?**: (`path`) => `void`

Defined in: [js/src/components.ts:274](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L274)

Fired when native back/link gestures mutate the NavigationStack path.

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
