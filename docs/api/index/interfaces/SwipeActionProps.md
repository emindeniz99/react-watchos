[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / SwipeActionProps

# Interface: SwipeActionProps

Defined in: [js/src/components.ts:193](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L193)

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

Defined in: [js/src/components.ts:198](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L198)

***

### leadingSwipeActionSystemImage?

> `optional` **leadingSwipeActionSystemImage?**: `string`

Defined in: [js/src/components.ts:199](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L199)

***

### leadingSwipeActionTint?

> `optional` **leadingSwipeActionTint?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:200](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L200)

***

### onLeadingSwipeAction?

> `optional` **onLeadingSwipeAction?**: () => `void`

Defined in: [js/src/components.ts:201](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L201)

#### Returns

`void`

***

### onSwipeAction?

> `optional` **onSwipeAction?**: () => `void`

Defined in: [js/src/components.ts:197](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L197)

#### Returns

`void`

***

### swipeActionLabel?

> `optional` **swipeActionLabel?**: `string`

Defined in: [js/src/components.ts:194](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L194)

***

### swipeActionSystemImage?

> `optional` **swipeActionSystemImage?**: `string`

Defined in: [js/src/components.ts:195](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L195)

***

### swipeActionTint?

> `optional` **swipeActionTint?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:196](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L196)
