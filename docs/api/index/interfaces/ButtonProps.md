[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / ButtonProps

# Interface: ButtonProps

Defined in: [js/src/components.ts:247](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L247)

Swipe actions (SwiftUI `.swipeActions`), the watchOS-idiomatic way to act on
a row. Only meaningful on a row inside a `<List>`; unlike a raw `onSwipe`
gesture they don't fight the scroll view, and a full ("long") swipe triggers
the action without tapping its button. The `*Label` presence enables each
edge independently:
 - trailing (right-to-left): `swipeActionLabel` / `onSwipeAction`
 - leading (left-to-right): `leadingSwipeActionLabel` / `onLeadingSwipeAction`

## Extends

- `A11yProps`.`GestureProps`.[`SwipeActionProps`](SwipeActionProps.md).`ModifierProps`

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

### buttonStyle?

> `optional` **buttonStyle?**: `"glass"` \| `"glassProminent"` \| `"plain"`

Defined in: [js/src/components.ts:277](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L277)

Button chrome. "glass"/"glassProminent" are Liquid Glass (watchOS 26+;
silently the default on older watches; "glassProminent" is the accented
fill). "plain" strips all chrome so the content IS the button — use it with
your own `background`/`cornerRadius`/`padding` to build a custom control
(e.g. a circular icon button). Omit for the standard watchOS button.

**App-only: a no-op in complications and Smart Stack widgets.** A widget's
interactive button hard-codes `.buttonStyle(.plain)`, so every value here
— including "plain" — has no effect on a watch face. Declared in
`codegen/schema.ts` `propDegradations` and listed in
`docs/api/capabilities.md`.

***

### children?

> `optional` **children?**: `ReactNode`

Defined in: [js/src/components.ts:278](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L278)

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

### intent?

> `optional` **intent?**: `string`

Defined in: [js/src/components.ts:263](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L263)

Makes this button interactive **inside a widget/complication** (watchOS
11+): a tap runs the `registerIntent(name, …)` handler in the widget
extension (no app launch), which mutates Storage and reloads the timeline —
the same mechanism a Control uses. `onPress` is for the in-app UI and is
ignored in a widget; `intent` is for a widget and is ignored in the app. On
watchOS 10 a widget button falls back to its (non-interactive) content.

***

### leadingSwipeActionLabel?

> `optional` **leadingSwipeActionLabel?**: `string`

Defined in: [js/src/components.ts:198](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L198)

#### Inherited from

[`SwipeActionProps`](SwipeActionProps.md).[`leadingSwipeActionLabel`](SwipeActionProps.md#leadingswipeactionlabel)

***

### leadingSwipeActionSystemImage?

> `optional` **leadingSwipeActionSystemImage?**: `string`

Defined in: [js/src/components.ts:199](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L199)

#### Inherited from

[`SwipeActionProps`](SwipeActionProps.md).[`leadingSwipeActionSystemImage`](SwipeActionProps.md#leadingswipeactionsystemimage)

***

### leadingSwipeActionTint?

> `optional` **leadingSwipeActionTint?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:200](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L200)

#### Inherited from

[`SwipeActionProps`](SwipeActionProps.md).[`leadingSwipeActionTint`](SwipeActionProps.md#leadingswipeactiontint)

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

### onLeadingSwipeAction?

> `optional` **onLeadingSwipeAction?**: () => `void`

Defined in: [js/src/components.ts:201](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L201)

#### Returns

`void`

#### Inherited from

[`SwipeActionProps`](SwipeActionProps.md).[`onLeadingSwipeAction`](SwipeActionProps.md#onleadingswipeaction)

***

### onLongPress?

> `optional` **onLongPress?**: () => `void`

Defined in: [js/src/components.ts:163](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L163)

#### Returns

`void`

#### Inherited from

`GestureProps.onLongPress`

***

### onPress?

> `optional` **onPress?**: () => `void`

Defined in: [js/src/components.ts:252](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L252)

#### Returns

`void`

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

### onSwipeAction?

> `optional` **onSwipeAction?**: () => `void`

Defined in: [js/src/components.ts:197](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L197)

#### Returns

`void`

#### Inherited from

[`SwipeActionProps`](SwipeActionProps.md).[`onSwipeAction`](SwipeActionProps.md#onswipeaction)

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

### primaryAction?

> `optional` **primaryAction?**: `boolean`

Defined in: [js/src/components.ts:254](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L254)

Bind this button to the Apple Watch double-tap gesture (watchOS 11+).

***

### swipeActionLabel?

> `optional` **swipeActionLabel?**: `string`

Defined in: [js/src/components.ts:194](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L194)

#### Inherited from

[`SwipeActionProps`](SwipeActionProps.md).[`swipeActionLabel`](SwipeActionProps.md#swipeactionlabel)

***

### swipeActionSystemImage?

> `optional` **swipeActionSystemImage?**: `string`

Defined in: [js/src/components.ts:195](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L195)

#### Inherited from

[`SwipeActionProps`](SwipeActionProps.md).[`swipeActionSystemImage`](SwipeActionProps.md#swipeactionsystemimage)

***

### swipeActionTint?

> `optional` **swipeActionTint?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:196](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L196)

#### Inherited from

[`SwipeActionProps`](SwipeActionProps.md).[`swipeActionTint`](SwipeActionProps.md#swipeactiontint)

***

### tint?

> `optional` **tint?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:138](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L138)

Accent color for this subtree's controls (SwiftUI .tint).

#### Inherited from

`ModifierProps.tint`
