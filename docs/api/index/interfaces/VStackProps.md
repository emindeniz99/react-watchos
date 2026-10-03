[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / VStackProps

# Interface: VStackProps

Defined in: [js/src/components.ts:214](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L214)

## Extends

- `A11yProps`.`GestureProps`.`ModifierProps`

## Properties

### accessibilityHidden?

> `optional` **accessibilityHidden?**: `boolean`

Defined in: [js/src/components.ts:100](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L100)

Hides this node and its whole subtree from VoiceOver (SwiftUI
`.accessibilityHidden(true)`, applied after label and hint, so it wins
over both). For purely decorative nodes such as a large quote mark or a
drop cap, which VoiceOver would otherwise read out as noise. Never set it
on anything interactive, or on a container holding interactive children:
a hidden control cannot be reached with VoiceOver at all.

#### Inherited from

`A11yProps.accessibilityHidden`

***

### accessibilityHint?

> `optional` **accessibilityHint?**: `string`

Defined in: [js/src/components.ts:91](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L91)

#### Inherited from

`A11yProps.accessibilityHint`

***

### accessibilityLabel?

> `optional` **accessibilityLabel?**: `string`

Defined in: [js/src/components.ts:90](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L90)

#### Inherited from

`A11yProps.accessibilityLabel`

***

### alignment?

> `optional` **alignment?**: `"leading"` \| `"trailing"` \| `"center"`

Defined in: [js/src/components.ts:217](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L217)

Horizontal alignment of children (SwiftUI VStack(alignment:)).

***

### animation?

> `optional` **animation?**: `object`

Defined in: [js/src/components.ts:161](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L161)

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

Defined in: [js/src/components.ts:125](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L125)

Colour or gradient behind the content (rounded when cornerRadius is set):
`background="#1C1B18"` or
`background={{ type: "linearGradient", colors: ["indigo", "black"] }}`.

#### Inherited from

`ModifierProps.background`

***

### children?

> `optional` **children?**: `ReactNode`

Defined in: [js/src/components.ts:218](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L218)

***

### containerBackground?

> `optional` **containerBackground?**: [`Fill`](../type-aliases/Fill.md)

Defined in: [js/src/components.ts:135](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L135)

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

Defined in: [js/src/components.ts:144](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L144)

Rounds the background — or clips the content when there is none.

#### Inherited from

`ModifierProps.cornerRadius`

***

### focusable?

> `optional` **focusable?**: `boolean`

Defined in: [js/src/components.ts:180](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L180)

Make this view Crown/focus-addressable (watchOS focus traversal).
 To programmatically CLAIM the Crown, use `<CrownRotation focused>` —
 see docs/design-focus-management.md.

#### Inherited from

`GestureProps.focusable`

***

### fontDesign?

> `optional` **fontDesign?**: `"default"` \| `"serif"` \| `"rounded"` \| `"monospaced"`

Defined in: [js/src/components.ts:142](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L142)

Type family within the system font (SwiftUI `.fontDesign`): `"serif"` is
New York, `"rounded"` SF Rounded, `"monospaced"` SF Mono. Set on a stack,
it applies to every Text inside; a Text (or nested segment) that sets its
own wins. Works with `textStyle`, so Dynamic Type still applies.

#### Inherited from

`ModifierProps.fontDesign`

***

### frame?

> `optional` **frame?**: `object`

Defined in: [js/src/components.ts:114](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L114)

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

Defined in: [js/src/components.ts:191](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L191)

Apply the watchOS 26 Liquid Glass effect.

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

Defined in: [js/src/components.ts:154](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L154)

Let this node extend under the safe area (SwiftUI `.ignoresSafeArea()`).
Set it on an overlay stacked on a `fullScreen` map so bottom-anchored
controls reach the physical edge instead of floating above the inset.

#### Inherited from

`ModifierProps.ignoresSafeArea`

***

### onDrag?

> `optional` **onDrag?**: (`translation`) => `void`

Defined in: [js/src/components.ts:176](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L176)

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

Defined in: [js/src/components.ts:173](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L173)

#### Returns

`void`

#### Inherited from

`GestureProps.onLongPress`

***

### onSwipe?

> `optional` **onSwipe?**: (`direction`) => `void`

Defined in: [js/src/components.ts:174](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L174)

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

Defined in: [js/src/components.ts:146](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L146)

0 (invisible) … 1 (opaque).

#### Inherited from

`ModifierProps.opacity`

***

### padding?

> `optional` **padding?**: `number` \| \{ `horizontal?`: `number`; `vertical?`: `number`; \}

Defined in: [js/src/components.ts:112](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L112)

Points on all edges, or per axis: `padding={{horizontal: 8, vertical: 2}}`.

#### Inherited from

`ModifierProps.padding`

***

### spacing?

> `optional` **spacing?**: `number`

Defined in: [js/src/components.ts:215](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L215)

***

### tint?

> `optional` **tint?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:148](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L148)

Accent color for this subtree's controls (SwiftUI .tint).

#### Inherited from

`ModifierProps.tint`
