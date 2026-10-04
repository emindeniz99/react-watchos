[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / SwipeActionProps

# Interface: SwipeActionProps

Defined in: [js/src/components.ts:203](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L203)

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

Defined in: [js/src/components.ts:208](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L208)

***

### leadingSwipeActionSystemImage?

> `optional` **leadingSwipeActionSystemImage?**: `string`

Defined in: [js/src/components.ts:209](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L209)

***

### leadingSwipeActionTint?

> `optional` **leadingSwipeActionTint?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:210](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L210)

***

### onLeadingSwipeAction?

> `optional` **onLeadingSwipeAction?**: () => `void`

Defined in: [js/src/components.ts:211](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L211)

#### Returns

`void`

***

### onSwipeAction?

> `optional` **onSwipeAction?**: () => `void`

Defined in: [js/src/components.ts:207](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L207)

#### Returns

`void`

***

### swipeActionLabel?

> `optional` **swipeActionLabel?**: `string`

Defined in: [js/src/components.ts:204](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L204)

***

### swipeActionSystemImage?

> `optional` **swipeActionSystemImage?**: `string`

Defined in: [js/src/components.ts:205](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L205)

***

### swipeActionTint?

> `optional` **swipeActionTint?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:206](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L206)
