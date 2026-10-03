[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / ButtonProps

# Interface: ButtonProps

Defined in: [js/src/components.ts:224](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L224)

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

### buttonStyle?

> `optional` **buttonStyle?**: `"glass"` \| `"glassProminent"` \| `"plain"`

Defined in: [js/src/components.ts:254](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L254)

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

Defined in: [js/src/components.ts:255](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L255)

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

### intent?

> `optional` **intent?**: `string`

Defined in: [js/src/components.ts:240](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L240)

Makes this button interactive **inside a widget/complication** (watchOS
11+): a tap runs the `registerIntent(name, …)` handler in the widget
extension (no app launch), which mutates Storage and reloads the timeline —
the same mechanism a Control uses. `onPress` is for the in-app UI and is
ignored in a widget; `intent` is for a widget and is ignored in the app. On
watchOS 10 a widget button falls back to its (non-interactive) content.

***

### leadingSwipeActionLabel?

> `optional` **leadingSwipeActionLabel?**: `string`

Defined in: [js/src/components.ts:168](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L168)

#### Inherited from

[`SwipeActionProps`](SwipeActionProps.md).[`leadingSwipeActionLabel`](SwipeActionProps.md#leadingswipeactionlabel)

***

### leadingSwipeActionSystemImage?

> `optional` **leadingSwipeActionSystemImage?**: `string`

Defined in: [js/src/components.ts:169](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L169)

#### Inherited from

[`SwipeActionProps`](SwipeActionProps.md).[`leadingSwipeActionSystemImage`](SwipeActionProps.md#leadingswipeactionsystemimage)

***

### leadingSwipeActionTint?

> `optional` **leadingSwipeActionTint?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:170](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L170)

#### Inherited from

[`SwipeActionProps`](SwipeActionProps.md).[`leadingSwipeActionTint`](SwipeActionProps.md#leadingswipeactiontint)

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

### onLeadingSwipeAction?

> `optional` **onLeadingSwipeAction?**: () => `void`

Defined in: [js/src/components.ts:171](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L171)

#### Returns

`void`

#### Inherited from

[`SwipeActionProps`](SwipeActionProps.md).[`onLeadingSwipeAction`](SwipeActionProps.md#onleadingswipeaction)

***

### onLongPress?

> `optional` **onLongPress?**: () => `void`

Defined in: [js/src/components.ts:133](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L133)

#### Returns

`void`

#### Inherited from

`GestureProps.onLongPress`

***

### onPress?

> `optional` **onPress?**: () => `void`

Defined in: [js/src/components.ts:229](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L229)

#### Returns

`void`

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

### onSwipeAction?

> `optional` **onSwipeAction?**: () => `void`

Defined in: [js/src/components.ts:167](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L167)

#### Returns

`void`

#### Inherited from

[`SwipeActionProps`](SwipeActionProps.md).[`onSwipeAction`](SwipeActionProps.md#onswipeaction)

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

### primaryAction?

> `optional` **primaryAction?**: `boolean`

Defined in: [js/src/components.ts:231](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L231)

Bind this button to the Apple Watch double-tap gesture (watchOS 11+).

***

### swipeActionLabel?

> `optional` **swipeActionLabel?**: `string`

Defined in: [js/src/components.ts:164](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L164)

#### Inherited from

[`SwipeActionProps`](SwipeActionProps.md).[`swipeActionLabel`](SwipeActionProps.md#swipeactionlabel)

***

### swipeActionSystemImage?

> `optional` **swipeActionSystemImage?**: `string`

Defined in: [js/src/components.ts:165](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L165)

#### Inherited from

[`SwipeActionProps`](SwipeActionProps.md).[`swipeActionSystemImage`](SwipeActionProps.md#swipeactionsystemimage)

***

### swipeActionTint?

> `optional` **swipeActionTint?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:166](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L166)

#### Inherited from

[`SwipeActionProps`](SwipeActionProps.md).[`swipeActionTint`](SwipeActionProps.md#swipeactiontint)

***

### tint?

> `optional` **tint?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:108](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L108)

Accent color for this subtree's controls (SwiftUI .tint).

#### Inherited from

`ModifierProps.tint`
