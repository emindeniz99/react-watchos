[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / CrownRotationProps

# Interface: CrownRotationProps

Defined in: [js/src/components.ts:345](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/components.ts#L345)

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

Defined in: [js/src/components.ts:18](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/components.ts#L18)

#### Inherited from

`A11yProps.accessibilityHint`

***

### accessibilityLabel?

> `optional` **accessibilityLabel?**: `string`

Defined in: [js/src/components.ts:17](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/components.ts#L17)

#### Inherited from

`A11yProps.accessibilityLabel`

***

### children?

> `optional` **children?**: `ReactNode`

Defined in: [js/src/components.ts:356](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/components.ts#L356)

***

### from?

> `optional` **from?**: `number`

Defined in: [js/src/components.ts:348](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/components.ts#L348)

Range lower bound (default 0).

***

### haptic?

> `optional` **haptic?**: `boolean`

Defined in: [js/src/components.ts:354](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/components.ts#L354)

Crown haptic detents (default true).

***

### onChange?

> `optional` **onChange?**: (`value`) => `void`

Defined in: [js/src/components.ts:355](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/components.ts#L355)

#### Parameters

##### value

`number`

#### Returns

`void`

***

### step?

> `optional` **step?**: `number`

Defined in: [js/src/components.ts:352](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/components.ts#L352)

Detent size (default 1).

***

### through?

> `optional` **through?**: `number`

Defined in: [js/src/components.ts:350](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/components.ts#L350)

Range upper bound (default 100).

***

### value

> **value**: `number`

Defined in: [js/src/components.ts:346](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/components.ts#L346)
