[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / SwipeActionProps

# Interface: SwipeActionProps

Defined in: [js/src/components.ts:163](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L163)

Swipe actions (SwiftUI `.swipeActions`), the watchOS-idiomatic way to act on
a row. Only meaningful on a row inside a `<List>`; unlike a raw `onSwipe`
gesture they don't fight the scroll view, and a full ("long") swipe triggers
the action without tapping its button. The `*Label` presence enables each
edge independently:
 - trailing (right-to-left): `swipeActionLabel` / `onSwipeAction`
 - leading (left-to-right): `leadingSwipeActionLabel` / `onLeadingSwipeAction`

## Extended by

- [`ButtonProps`](ButtonProps.md)

## Properties

### leadingSwipeActionLabel?

> `optional` **leadingSwipeActionLabel?**: `string`

Defined in: [js/src/components.ts:168](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L168)

***

### leadingSwipeActionSystemImage?

> `optional` **leadingSwipeActionSystemImage?**: `string`

Defined in: [js/src/components.ts:169](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L169)

***

### leadingSwipeActionTint?

> `optional` **leadingSwipeActionTint?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:170](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L170)

***

### onLeadingSwipeAction?

> `optional` **onLeadingSwipeAction?**: () => `void`

Defined in: [js/src/components.ts:171](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L171)

#### Returns

`void`

***

### onSwipeAction?

> `optional` **onSwipeAction?**: () => `void`

Defined in: [js/src/components.ts:167](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L167)

#### Returns

`void`

***

### swipeActionLabel?

> `optional` **swipeActionLabel?**: `string`

Defined in: [js/src/components.ts:164](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L164)

***

### swipeActionSystemImage?

> `optional` **swipeActionSystemImage?**: `string`

Defined in: [js/src/components.ts:165](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L165)

***

### swipeActionTint?

> `optional` **swipeActionTint?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:166](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L166)
