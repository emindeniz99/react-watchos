[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / VStackProps

# Interface: VStackProps

Defined in: [js/src/components.ts:93](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L93)

## Extends

- `A11yProps`.`GestureProps`.`ModifierProps`

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

### alignment?

> `optional` **alignment?**: `"leading"` \| `"center"` \| `"trailing"`

Defined in: [js/src/components.ts:96](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L96)

Horizontal alignment of children (SwiftUI VStack(alignment:)).

***

### animation?

> `optional` **animation?**: `object`

Defined in: [js/src/components.ts:51](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L51)

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

Defined in: [js/src/components.ts:38](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L38)

Fill color behind the content (rounded when cornerRadius is set).

#### Inherited from

`ModifierProps.background`

***

### children?

> `optional` **children?**: `ReactNode`

Defined in: [js/src/components.ts:97](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L97)

***

### cornerRadius?

> `optional` **cornerRadius?**: `number`

Defined in: [js/src/components.ts:40](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L40)

Rounds the background — or clips the content when there is none.

#### Inherited from

`ModifierProps.cornerRadius`

***

### focusable?

> `optional` **focusable?**: `boolean`

Defined in: [js/src/components.ts:68](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L68)

Make this view Crown/focus-addressable (watchOS focus traversal).

#### Inherited from

`GestureProps.focusable`

***

### frame?

> `optional` **frame?**: `object`

Defined in: [js/src/components.ts:31](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L31)

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

### glass?

> `optional` **glass?**: `boolean`

Defined in: [js/src/components.ts:70](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L70)

Apply the watchOS 26 Liquid Glass effect (no-op on older OSes).

#### Inherited from

`GestureProps.glass`

***

### onDrag?

> `optional` **onDrag?**: (`translation`) => `void`

Defined in: [js/src/components.ts:66](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L66)

Streamed drag translation (quantized to throttle the bridge) — for scrubbing.

#### Parameters

##### translation

###### x

`number`

###### y

`number`

#### Returns

`void`

#### Inherited from

`GestureProps.onDrag`

***

### onLongPress?

> `optional` **onLongPress?**: () => `void`

Defined in: [js/src/components.ts:63](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L63)

#### Returns

`void`

#### Inherited from

`GestureProps.onLongPress`

***

### onSwipe?

> `optional` **onSwipe?**: (`direction`) => `void`

Defined in: [js/src/components.ts:64](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L64)

#### Parameters

##### direction

`"left"` \| `"right"` \| `"up"` \| `"down"`

#### Returns

`void`

#### Inherited from

`GestureProps.onSwipe`

***

### opacity?

> `optional` **opacity?**: `number`

Defined in: [js/src/components.ts:42](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L42)

0 (invisible) … 1 (opaque).

#### Inherited from

`ModifierProps.opacity`

***

### padding?

> `optional` **padding?**: `number` \| \{ `horizontal?`: `number`; `vertical?`: `number`; \}

Defined in: [js/src/components.ts:29](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L29)

Points on all edges, or per axis: `padding={{horizontal: 8, vertical: 2}}`.

#### Inherited from

`ModifierProps.padding`

***

### spacing?

> `optional` **spacing?**: `number`

Defined in: [js/src/components.ts:94](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L94)

***

### tint?

> `optional` **tint?**: `string`

Defined in: [js/src/components.ts:44](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L44)

Accent color for this subtree's controls (SwiftUI .tint).

#### Inherited from

`ModifierProps.tint`
