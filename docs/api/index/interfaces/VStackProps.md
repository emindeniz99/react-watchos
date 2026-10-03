[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / VStackProps

# Interface: VStackProps

Defined in: [js/src/components.ts:174](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L174)

## Extends

- `A11yProps`.`GestureProps`.`ModifierProps`

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

### alignment?

> `optional` **alignment?**: `"leading"` \| `"trailing"` \| `"center"`

Defined in: [js/src/components.ts:177](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L177)

Horizontal alignment of children (SwiftUI VStack(alignment:)).

***

### animation?

> `optional` **animation?**: `object`

Defined in: [js/src/components.ts:121](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L121)

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

> `optional` **background?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:96](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L96)

Fill color behind the content (rounded when cornerRadius is set).

#### Inherited from

`ModifierProps.background`

***

### backgroundGradient?

> `optional` **backgroundGradient?**: `LinearGradientValue`

Defined in: [js/src/components.ts:102](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L102)

Gradient fill behind the content, drawn where `background` would be
(same cornerRadius rounding, same stroke in an accented complication).
Takes precedence over `background` when both are set.

#### Inherited from

`ModifierProps.backgroundGradient`

***

### children?

> `optional` **children?**: `ReactNode`

Defined in: [js/src/components.ts:178](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L178)

***

### cornerRadius?

> `optional` **cornerRadius?**: `number`

Defined in: [js/src/components.ts:104](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L104)

Rounds the background — or clips the content when there is none.

#### Inherited from

`ModifierProps.cornerRadius`

***

### focusable?

> `optional` **focusable?**: `boolean`

Defined in: [js/src/components.ts:140](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L140)

Make this view Crown/focus-addressable (watchOS focus traversal).
 To programmatically CLAIM the Crown, use `<CrownRotation focused>` —
 see docs/design-focus-management.md.

#### Inherited from

`GestureProps.focusable`

***

### frame?

> `optional` **frame?**: `object`

Defined in: [js/src/components.ts:89](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L89)

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

Defined in: [js/src/components.ts:151](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L151)

Apply the watchOS 26 Liquid Glass effect (no-op on older OSes).

**App-only: a no-op in complications and Smart Stack widgets.** It is
applied in the app interpreter's shared modifier chain, which the widget
interpreter's `applyLayout` does not mirror — so the same JS that glasses
a view in the app renders it plain on a watch face. Declared in
`codegen/schema.ts` `propDegradations` and listed in
`docs/api/capabilities.md`.

#### Inherited from

`GestureProps.glass`

***

### ignoresSafeArea?

> `optional` **ignoresSafeArea?**: `boolean`

Defined in: [js/src/components.ts:114](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L114)

Let this node extend under the safe area (SwiftUI `.ignoresSafeArea()`).
Set it on an overlay stacked on a `fullScreen` map so bottom-anchored
controls reach the physical edge instead of floating above the inset.

#### Inherited from

`ModifierProps.ignoresSafeArea`

***

### onDrag?

> `optional` **onDrag?**: (`translation`) => `void`

Defined in: [js/src/components.ts:136](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L136)

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

Defined in: [js/src/components.ts:133](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L133)

#### Returns

`void`

#### Inherited from

`GestureProps.onLongPress`

***

### onSwipe?

> `optional` **onSwipe?**: (`direction`) => `void`

Defined in: [js/src/components.ts:134](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L134)

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

Defined in: [js/src/components.ts:106](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L106)

0 (invisible) … 1 (opaque).

#### Inherited from

`ModifierProps.opacity`

***

### padding?

> `optional` **padding?**: `number` \| \{ `horizontal?`: `number`; `vertical?`: `number`; \}

Defined in: [js/src/components.ts:87](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L87)

Points on all edges, or per axis: `padding={{horizontal: 8, vertical: 2}}`.

#### Inherited from

`ModifierProps.padding`

***

### spacing?

> `optional` **spacing?**: `number`

Defined in: [js/src/components.ts:175](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L175)

***

### tint?

> `optional` **tint?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:108](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L108)

Accent color for this subtree's controls (SwiftUI .tint).

#### Inherited from

`ModifierProps.tint`
