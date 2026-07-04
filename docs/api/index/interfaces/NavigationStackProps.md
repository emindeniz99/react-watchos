[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / NavigationStackProps

# Interface: NavigationStackProps

Defined in: [js/src/components.ts:222](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L222)

## Extends

- `A11yProps`

## Properties

### accessibilityHint?

> `optional` **accessibilityHint?**: `string`

Defined in: [js/src/components.ts:18](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L18)

#### Inherited from

`A11yProps.accessibilityHint`

***

### accessibilityLabel?

> `optional` **accessibilityLabel?**: `string`

Defined in: [js/src/components.ts:17](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L17)

#### Inherited from

`A11yProps.accessibilityLabel`

***

### children?

> `optional` **children?**: `ReactNode`

Defined in: [js/src/components.ts:231](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L231)

***

### onPathChange?

> `optional` **onPathChange?**: (`path`) => `void`

Defined in: [js/src/components.ts:230](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L230)

Fired when native back/link gestures mutate the NavigationStack path.

#### Parameters

##### path

`string`[]

#### Returns

`void`

***

### path?

> `optional` **path?**: `string`[]

Defined in: [js/src/components.ts:228](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L228)

Controlled native stack path. Root is represented by [] and pushed
routes are stable path strings such as ["/hydration"].

***

### title?

> `optional` **title?**: `string`

Defined in: [js/src/components.ts:223](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L223)
