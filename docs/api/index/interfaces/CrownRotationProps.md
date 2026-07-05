[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / CrownRotationProps

# Interface: CrownRotationProps

Defined in: [js/src/components.ts:434](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L434)

Binds the Digital Crown to a numeric value over its children (SwiftUI
`digitalCrownRotation`). The wrapped view becomes crown-focusable;
rotating the Crown fires `onChange` with the new value. Use for volume,
zoom, scrubbing — anything the Crown should drive directly (vs. the
Crown's implicit role inside Picker/ScrollView).

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

Defined in: [js/src/components.ts:445](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L445)

***

### from?

> `optional` **from?**: `number`

Defined in: [js/src/components.ts:437](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L437)

Range lower bound (default 0).

***

### haptic?

> `optional` **haptic?**: `boolean`

Defined in: [js/src/components.ts:443](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L443)

Crown haptic detents (default true).

***

### onChange?

> `optional` **onChange?**: (`value`) => `void`

Defined in: [js/src/components.ts:444](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L444)

#### Parameters

##### value

`number`

#### Returns

`void`

***

### step?

> `optional` **step?**: `number`

Defined in: [js/src/components.ts:441](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L441)

Detent size (default 1).

***

### through?

> `optional` **through?**: `number`

Defined in: [js/src/components.ts:439](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L439)

Range upper bound (default 100).

***

### value

> **value**: `number`

Defined in: [js/src/components.ts:435](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L435)
