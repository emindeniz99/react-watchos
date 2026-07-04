[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / SwipeActionProps

# Interface: SwipeActionProps

Defined in: [js/src/components.ts:82](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L82)

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

Defined in: [js/src/components.ts:87](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L87)

***

### leadingSwipeActionSystemImage?

> `optional` **leadingSwipeActionSystemImage?**: `string`

Defined in: [js/src/components.ts:88](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L88)

***

### leadingSwipeActionTint?

> `optional` **leadingSwipeActionTint?**: `string`

Defined in: [js/src/components.ts:89](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L89)

***

### onLeadingSwipeAction?

> `optional` **onLeadingSwipeAction?**: () => `void`

Defined in: [js/src/components.ts:90](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L90)

#### Returns

`void`

***

### onSwipeAction?

> `optional` **onSwipeAction?**: () => `void`

Defined in: [js/src/components.ts:86](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L86)

#### Returns

`void`

***

### swipeActionLabel?

> `optional` **swipeActionLabel?**: `string`

Defined in: [js/src/components.ts:83](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L83)

***

### swipeActionSystemImage?

> `optional` **swipeActionSystemImage?**: `string`

Defined in: [js/src/components.ts:84](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L84)

***

### swipeActionTint?

> `optional` **swipeActionTint?**: `string`

Defined in: [js/src/components.ts:85](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L85)
