[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / StepperProps

# Interface: StepperProps

Defined in: [js/src/components.ts:299](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/components.ts#L299)

Numeric +/- stepper.

## Extends

- `A11yProps`.`ModifierProps`

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

### animation?

> `optional` **animation?**: `object`

Defined in: [js/src/components.ts:51](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/components.ts#L51)

Animate this node's committed changes (SwiftUI `.animation(_:value:)`):
any prop or subtree change transitions with the given curve instead of
snapping. `duration` in seconds (omit for the curve's default). App
only — widgets are static snapshots and ignore it.

#### duration?

> `optional` **duration?**: `number`

#### kind

> **kind**: `"spring"` \| `"ease"` \| `"easeIn"` \| `"easeOut"` \| `"linear"`

#### Inherited from

`ModifierProps.animation`

***

### background?

> `optional` **background?**: `string`

Defined in: [js/src/components.ts:38](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/components.ts#L38)

Fill color behind the content (rounded when cornerRadius is set).

#### Inherited from

`ModifierProps.background`

***

### cornerRadius?

> `optional` **cornerRadius?**: `number`

Defined in: [js/src/components.ts:40](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/components.ts#L40)

Rounds the background — or clips the content when there is none.

#### Inherited from

`ModifierProps.cornerRadius`

***

### frame?

> `optional` **frame?**: `object`

Defined in: [js/src/components.ts:31](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/components.ts#L31)

Fixed and/or max dimensions; `"infinity"` = SwiftUI's fill idiom.

#### height?

> `optional` **height?**: `number`

#### maxHeight?

> `optional` **maxHeight?**: `number` \| `"infinity"`

#### maxWidth?

> `optional` **maxWidth?**: `number` \| `"infinity"`

#### width?

> `optional` **width?**: `number`

#### Inherited from

`ModifierProps.frame`

***

### from?

> `optional` **from?**: `number`

Defined in: [js/src/components.ts:301](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/components.ts#L301)

***

### label?

> `optional` **label?**: `string`

Defined in: [js/src/components.ts:304](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/components.ts#L304)

***

### onChange?

> `optional` **onChange?**: (`value`) => `void`

Defined in: [js/src/components.ts:305](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/components.ts#L305)

#### Parameters

##### value

`number`

#### Returns

`void`

***

### opacity?

> `optional` **opacity?**: `number`

Defined in: [js/src/components.ts:42](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/components.ts#L42)

0 (invisible) … 1 (opaque).

#### Inherited from

`ModifierProps.opacity`

***

### padding?

> `optional` **padding?**: `number` \| \{ `horizontal?`: `number`; `vertical?`: `number`; \}

Defined in: [js/src/components.ts:29](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/components.ts#L29)

Points on all edges, or per axis: `padding={{horizontal: 8, vertical: 2}}`.

#### Inherited from

`ModifierProps.padding`

***

### step?

> `optional` **step?**: `number`

Defined in: [js/src/components.ts:303](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/components.ts#L303)

***

### through?

> `optional` **through?**: `number`

Defined in: [js/src/components.ts:302](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/components.ts#L302)

***

### tint?

> `optional` **tint?**: `string`

Defined in: [js/src/components.ts:44](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/components.ts#L44)

Accent color for this subtree's controls (SwiftUI .tint).

#### Inherited from

`ModifierProps.tint`

***

### value

> **value**: `number`

Defined in: [js/src/components.ts:300](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/components.ts#L300)
