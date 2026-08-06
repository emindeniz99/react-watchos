[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / TextFieldProps

# Interface: TextFieldProps

Defined in: [js/src/components.ts:326](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/components.ts#L326)

## Extends

- `A11yProps`.`ModifierProps`

## Properties

### accessibilityHint?

> `optional` **accessibilityHint?**: `string`

Defined in: [js/src/components.ts:53](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/components.ts#L53)

#### Inherited from

`A11yProps.accessibilityHint`

***

### accessibilityLabel?

> `optional` **accessibilityLabel?**: `string`

Defined in: [js/src/components.ts:52](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/components.ts#L52)

#### Inherited from

`A11yProps.accessibilityLabel`

***

### animation?

> `optional` **animation?**: `object`

Defined in: [js/src/components.ts:92](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/components.ts#L92)

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

### autoFocus?

> `optional` **autoFocus?**: `boolean`

Defined in: [js/src/components.ts:337](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/components.ts#L337)

Request focus as soon as the field appears (e.g. a search field revealed by
a button). On iOS this opens the keyboard; on **watchOS the system still
requires a tap on the field** to present the input modal, so it's a hint,
not a guarantee — the field stays tappable either way.

***

### background?

> `optional` **background?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:73](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/components.ts#L73)

Fill color behind the content (rounded when cornerRadius is set).

#### Inherited from

`ModifierProps.background`

***

### cornerRadius?

> `optional` **cornerRadius?**: `number`

Defined in: [js/src/components.ts:75](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/components.ts#L75)

Rounds the background — or clips the content when there is none.

#### Inherited from

`ModifierProps.cornerRadius`

***

### frame?

> `optional` **frame?**: `object`

Defined in: [js/src/components.ts:66](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/components.ts#L66)

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

### ignoresSafeArea?

> `optional` **ignoresSafeArea?**: `boolean`

Defined in: [js/src/components.ts:85](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/components.ts#L85)

Let this node extend under the safe area (SwiftUI `.ignoresSafeArea()`).
Set it on an overlay stacked on a `fullScreen` map so bottom-anchored
controls reach the physical edge instead of floating above the inset.

#### Inherited from

`ModifierProps.ignoresSafeArea`

***

### onChange?

> `optional` **onChange?**: (`value`) => `void`

Defined in: [js/src/components.ts:330](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/components.ts#L330)

Fired on input commit (watchOS input is modal: dictation/scribble/QWERTY).

#### Parameters

##### value

`string`

#### Returns

`void`

***

### opacity?

> `optional` **opacity?**: `number`

Defined in: [js/src/components.ts:77](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/components.ts#L77)

0 (invisible) … 1 (opaque).

#### Inherited from

`ModifierProps.opacity`

***

### padding?

> `optional` **padding?**: `number` \| \{ `horizontal?`: `number`; `vertical?`: `number`; \}

Defined in: [js/src/components.ts:64](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/components.ts#L64)

Points on all edges, or per axis: `padding={{horizontal: 8, vertical: 2}}`.

#### Inherited from

`ModifierProps.padding`

***

### placeholder?

> `optional` **placeholder?**: `string`

Defined in: [js/src/components.ts:328](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/components.ts#L328)

***

### tint?

> `optional` **tint?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:79](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/components.ts#L79)

Accent color for this subtree's controls (SwiftUI .tint).

#### Inherited from

`ModifierProps.tint`

***

### value?

> `optional` **value?**: `string`

Defined in: [js/src/components.ts:327](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/components.ts#L327)
