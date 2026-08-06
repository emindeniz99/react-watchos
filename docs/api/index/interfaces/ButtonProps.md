[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / ButtonProps

# Interface: ButtonProps

Defined in: [js/src/components.ts:186](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/components.ts#L186)

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

### background?

> `optional` **background?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:73](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/components.ts#L73)

Fill color behind the content (rounded when cornerRadius is set).

#### Inherited from

`ModifierProps.background`

***

### buttonStyle?

> `optional` **buttonStyle?**: `"glass"` \| `"glassProminent"` \| `"plain"`

Defined in: [js/src/components.ts:216](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/components.ts#L216)

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

Defined in: [js/src/components.ts:217](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/components.ts#L217)

***

### cornerRadius?

> `optional` **cornerRadius?**: `number`

Defined in: [js/src/components.ts:75](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/components.ts#L75)

Rounds the background — or clips the content when there is none.

#### Inherited from

`ModifierProps.cornerRadius`

***

### focusable?

> `optional` **focusable?**: `boolean`

Defined in: [js/src/components.ts:109](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/components.ts#L109)

Make this view Crown/focus-addressable (watchOS focus traversal).

#### Inherited from

`GestureProps.focusable`

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

### glass?

> `optional` **glass?**: `boolean`

Defined in: [js/src/components.ts:120](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/components.ts#L120)

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

Defined in: [js/src/components.ts:85](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/components.ts#L85)

Let this node extend under the safe area (SwiftUI `.ignoresSafeArea()`).
Set it on an overlay stacked on a `fullScreen` map so bottom-anchored
controls reach the physical edge instead of floating above the inset.

#### Inherited from

`ModifierProps.ignoresSafeArea`

***

### intent?

> `optional` **intent?**: `string`

Defined in: [js/src/components.ts:202](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/components.ts#L202)

Makes this button interactive **inside a widget/complication** (watchOS
11+): a tap runs the `registerIntent(name, …)` handler in the widget
extension (no app launch), which mutates Storage and reloads the timeline —
the same mechanism a Control uses. `onPress` is for the in-app UI and is
ignored in a widget; `intent` is for a widget and is ignored in the app. On
watchOS 10 a widget button falls back to its (non-interactive) content.

***

### leadingSwipeActionLabel?

> `optional` **leadingSwipeActionLabel?**: `string`

Defined in: [js/src/components.ts:137](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/components.ts#L137)

#### Inherited from

[`SwipeActionProps`](SwipeActionProps.md).[`leadingSwipeActionLabel`](SwipeActionProps.md#leadingswipeactionlabel)

***

### leadingSwipeActionSystemImage?

> `optional` **leadingSwipeActionSystemImage?**: `string`

Defined in: [js/src/components.ts:138](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/components.ts#L138)

#### Inherited from

[`SwipeActionProps`](SwipeActionProps.md).[`leadingSwipeActionSystemImage`](SwipeActionProps.md#leadingswipeactionsystemimage)

***

### leadingSwipeActionTint?

> `optional` **leadingSwipeActionTint?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:139](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/components.ts#L139)

#### Inherited from

[`SwipeActionProps`](SwipeActionProps.md).[`leadingSwipeActionTint`](SwipeActionProps.md#leadingswipeactiontint)

***

### onDrag?

> `optional` **onDrag?**: (`translation`) => `void`

Defined in: [js/src/components.ts:107](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/components.ts#L107)

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

Defined in: [js/src/components.ts:140](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/components.ts#L140)

#### Returns

`void`

#### Inherited from

[`SwipeActionProps`](SwipeActionProps.md).[`onLeadingSwipeAction`](SwipeActionProps.md#onleadingswipeaction)

***

### onLongPress?

> `optional` **onLongPress?**: () => `void`

Defined in: [js/src/components.ts:104](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/components.ts#L104)

#### Returns

`void`

#### Inherited from

`GestureProps.onLongPress`

***

### onPress?

> `optional` **onPress?**: () => `void`

Defined in: [js/src/components.ts:191](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/components.ts#L191)

#### Returns

`void`

***

### onSwipe?

> `optional` **onSwipe?**: (`direction`) => `void`

Defined in: [js/src/components.ts:105](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/components.ts#L105)

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

Defined in: [js/src/components.ts:136](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/components.ts#L136)

#### Returns

`void`

#### Inherited from

[`SwipeActionProps`](SwipeActionProps.md).[`onSwipeAction`](SwipeActionProps.md#onswipeaction)

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

### primaryAction?

> `optional` **primaryAction?**: `boolean`

Defined in: [js/src/components.ts:193](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/components.ts#L193)

Bind this button to the Apple Watch double-tap gesture (watchOS 11+).

***

### swipeActionLabel?

> `optional` **swipeActionLabel?**: `string`

Defined in: [js/src/components.ts:133](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/components.ts#L133)

#### Inherited from

[`SwipeActionProps`](SwipeActionProps.md).[`swipeActionLabel`](SwipeActionProps.md#swipeactionlabel)

***

### swipeActionSystemImage?

> `optional` **swipeActionSystemImage?**: `string`

Defined in: [js/src/components.ts:134](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/components.ts#L134)

#### Inherited from

[`SwipeActionProps`](SwipeActionProps.md).[`swipeActionSystemImage`](SwipeActionProps.md#swipeactionsystemimage)

***

### swipeActionTint?

> `optional` **swipeActionTint?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:135](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/components.ts#L135)

#### Inherited from

[`SwipeActionProps`](SwipeActionProps.md).[`swipeActionTint`](SwipeActionProps.md#swipeactiontint)

***

### tint?

> `optional` **tint?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:79](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/components.ts#L79)

Accent color for this subtree's controls (SwiftUI .tint).

#### Inherited from

`ModifierProps.tint`
