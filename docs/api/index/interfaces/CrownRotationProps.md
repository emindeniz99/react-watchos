[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / CrownRotationProps

# Interface: CrownRotationProps

Defined in: [js/src/components.ts:466](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L466)

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

Defined in: [js/src/components.ts:477](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L477)

***

### haptic?

> `optional` **haptic?**: `boolean`

Defined in: [js/src/components.ts:475](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L475)

Crown haptic detents (default true).

***

### max?

> `optional` **max?**: `number`

Defined in: [js/src/components.ts:471](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L471)

Range upper bound (default 100).

***

### min?

> `optional` **min?**: `number`

Defined in: [js/src/components.ts:469](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L469)

Range lower bound (default 0).

***

### onChange?

> `optional` **onChange?**: (`value`) => `void`

Defined in: [js/src/components.ts:476](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L476)

#### Parameters

##### value

`number`

#### Returns

`void`

***

### step?

> `optional` **step?**: `number`

Defined in: [js/src/components.ts:473](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L473)

Detent size (default 1).

***

### value

> **value**: `number`

Defined in: [js/src/components.ts:467](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L467)
