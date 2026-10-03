[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / VStackProps

# Interface: VStackProps

Defined in: [js/src/components.ts:204](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L204)

## Extends

- `A11yProps`.`GestureProps`.`ModifierProps`

## Properties

### accessibilityHint?

> `optional` **accessibilityHint?**: `string`

Defined in: [js/src/components.ts:90](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L90)

#### Inherited from

`A11yProps.accessibilityHint`

***

### accessibilityLabel?

> `optional` **accessibilityLabel?**: `string`

Defined in: [js/src/components.ts:89](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L89)

#### Inherited from

`A11yProps.accessibilityLabel`

***

### alignment?

> `optional` **alignment?**: `"leading"` \| `"trailing"` \| `"center"`

Defined in: [js/src/components.ts:207](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L207)

Horizontal alignment of children (SwiftUI VStack(alignment:)).

***

### animation?

> `optional` **animation?**: `object`

Defined in: [js/src/components.ts:151](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L151)

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

> `optional` **background?**: [`Fill`](../type-aliases/Fill.md)

Defined in: [js/src/components.ts:115](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L115)

Colour or gradient behind the content (rounded when cornerRadius is set):
`background="#1C1B18"` or
`background={{ type: "linearGradient", colors: ["indigo", "black"] }}`.

#### Inherited from

`ModifierProps.background`

***

### children?

> `optional` **children?**: `ReactNode`

Defined in: [js/src/components.ts:208](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L208)

***

### containerBackground?

> `optional` **containerBackground?**: [`Fill`](../type-aliases/Fill.md)

Defined in: [js/src/components.ts:125](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L125)

Full-bleed page colour or gradient behind the system chrome (SwiftUI
`.containerBackground(_, for: .tabView)`). Set it on a TabView page, the
direct child of `<TabView>`; elsewhere it has nothing to fill.

**App-only: a no-op in complications and Smart Stack widgets.** The widget
container's background is fixed to clear. Declared in `codegen/schema.ts`
`propDegradations` and listed in `docs/api/capabilities.md`.

#### Inherited from

`ModifierProps.containerBackground`

***

### cornerRadius?

> `optional` **cornerRadius?**: `number`

Defined in: [js/src/components.ts:134](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L134)

Rounds the background — or clips the content when there is none.

#### Inherited from

`ModifierProps.cornerRadius`

***

### focusable?

> `optional` **focusable?**: `boolean`

Defined in: [js/src/components.ts:170](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L170)

Make this view Crown/focus-addressable (watchOS focus traversal).
 To programmatically CLAIM the Crown, use `<CrownRotation focused>` —
 see docs/design-focus-management.md.

#### Inherited from

`GestureProps.focusable`

***

### fontDesign?

> `optional` **fontDesign?**: `"default"` \| `"serif"` \| `"rounded"` \| `"monospaced"`

Defined in: [js/src/components.ts:132](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L132)

Type family within the system font (SwiftUI `.fontDesign`): `"serif"` is
New York, `"rounded"` SF Rounded, `"monospaced"` SF Mono. Set on a stack,
it applies to every Text inside; a Text (or nested segment) that sets its
own wins. Works with `textStyle`, so Dynamic Type still applies.

#### Inherited from

`ModifierProps.fontDesign`

***

### frame?

> `optional` **frame?**: `object`

Defined in: [js/src/components.ts:104](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L104)

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

Defined in: [js/src/components.ts:181](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L181)

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

Defined in: [js/src/components.ts:144](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L144)

Let this node extend under the safe area (SwiftUI `.ignoresSafeArea()`).
Set it on an overlay stacked on a `fullScreen` map so bottom-anchored
controls reach the physical edge instead of floating above the inset.

#### Inherited from

`ModifierProps.ignoresSafeArea`

***

### onDrag?

> `optional` **onDrag?**: (`translation`) => `void`

Defined in: [js/src/components.ts:166](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L166)

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

Defined in: [js/src/components.ts:163](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L163)

#### Returns

`void`

#### Inherited from

`GestureProps.onLongPress`

***

### onSwipe?

> `optional` **onSwipe?**: (`direction`) => `void`

Defined in: [js/src/components.ts:164](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L164)

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

Defined in: [js/src/components.ts:136](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L136)

0 (invisible) … 1 (opaque).

#### Inherited from

`ModifierProps.opacity`

***

### padding?

> `optional` **padding?**: `number` \| \{ `horizontal?`: `number`; `vertical?`: `number`; \}

Defined in: [js/src/components.ts:102](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L102)

Points on all edges, or per axis: `padding={{horizontal: 8, vertical: 2}}`.

#### Inherited from

`ModifierProps.padding`

***

### spacing?

> `optional` **spacing?**: `number`

Defined in: [js/src/components.ts:205](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L205)

***

### tint?

> `optional` **tint?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:138](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L138)

Accent color for this subtree's controls (SwiftUI .tint).

#### Inherited from

`ModifierProps.tint`
