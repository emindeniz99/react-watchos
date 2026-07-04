[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / ButtonProps

# Interface: ButtonProps

Defined in: [js/src/components.ts:136](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L136)

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

### buttonStyle?

> `optional` **buttonStyle?**: `"glass"` \| `"glassProminent"`

Defined in: [js/src/components.ts:157](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L157)

Liquid Glass button styles (watchOS 26+; silently the default style on
older watches). "glassProminent" is the accented/filled variant.

***

### children?

> `optional` **children?**: `ReactNode`

Defined in: [js/src/components.ts:158](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L158)

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

### intent?

> `optional` **intent?**: `string`

Defined in: [js/src/components.ts:152](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L152)

Makes this button interactive **inside a widget/complication** (watchOS
11+): a tap runs the `registerIntent(name, …)` handler in the widget
extension (no app launch), which mutates Storage and reloads the timeline —
the same mechanism a Control uses. `onPress` is for the in-app UI and is
ignored in a widget; `intent` is for a widget and is ignored in the app. On
watchOS 10 a widget button falls back to its (non-interactive) content.

***

### leadingSwipeActionLabel?

> `optional` **leadingSwipeActionLabel?**: `string`

Defined in: [js/src/components.ts:87](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L87)

#### Inherited from

[`SwipeActionProps`](SwipeActionProps.md).[`leadingSwipeActionLabel`](SwipeActionProps.md#leadingswipeactionlabel)

***

### leadingSwipeActionSystemImage?

> `optional` **leadingSwipeActionSystemImage?**: `string`

Defined in: [js/src/components.ts:88](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L88)

#### Inherited from

[`SwipeActionProps`](SwipeActionProps.md).[`leadingSwipeActionSystemImage`](SwipeActionProps.md#leadingswipeactionsystemimage)

***

### leadingSwipeActionTint?

> `optional` **leadingSwipeActionTint?**: `string`

Defined in: [js/src/components.ts:89](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L89)

#### Inherited from

[`SwipeActionProps`](SwipeActionProps.md).[`leadingSwipeActionTint`](SwipeActionProps.md#leadingswipeactiontint)

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

### onLeadingSwipeAction?

> `optional` **onLeadingSwipeAction?**: () => `void`

Defined in: [js/src/components.ts:90](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L90)

#### Returns

`void`

#### Inherited from

[`SwipeActionProps`](SwipeActionProps.md).[`onLeadingSwipeAction`](SwipeActionProps.md#onleadingswipeaction)

***

### onLongPress?

> `optional` **onLongPress?**: () => `void`

Defined in: [js/src/components.ts:63](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L63)

#### Returns

`void`

#### Inherited from

`GestureProps.onLongPress`

***

### onPress?

> `optional` **onPress?**: () => `void`

Defined in: [js/src/components.ts:141](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L141)

#### Returns

`void`

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

### onSwipeAction?

> `optional` **onSwipeAction?**: () => `void`

Defined in: [js/src/components.ts:86](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L86)

#### Returns

`void`

#### Inherited from

[`SwipeActionProps`](SwipeActionProps.md).[`onSwipeAction`](SwipeActionProps.md#onswipeaction)

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

### primaryAction?

> `optional` **primaryAction?**: `boolean`

Defined in: [js/src/components.ts:143](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L143)

Bind this button to the Apple Watch double-tap gesture (watchOS 11+).

***

### swipeActionLabel?

> `optional` **swipeActionLabel?**: `string`

Defined in: [js/src/components.ts:83](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L83)

#### Inherited from

[`SwipeActionProps`](SwipeActionProps.md).[`swipeActionLabel`](SwipeActionProps.md#swipeactionlabel)

***

### swipeActionSystemImage?

> `optional` **swipeActionSystemImage?**: `string`

Defined in: [js/src/components.ts:84](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L84)

#### Inherited from

[`SwipeActionProps`](SwipeActionProps.md).[`swipeActionSystemImage`](SwipeActionProps.md#swipeactionsystemimage)

***

### swipeActionTint?

> `optional` **swipeActionTint?**: `string`

Defined in: [js/src/components.ts:85](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L85)

#### Inherited from

[`SwipeActionProps`](SwipeActionProps.md).[`swipeActionTint`](SwipeActionProps.md#swipeactiontint)

***

### tint?

> `optional` **tint?**: `string`

Defined in: [js/src/components.ts:44](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L44)

Accent color for this subtree's controls (SwiftUI .tint).

#### Inherited from

`ModifierProps.tint`
