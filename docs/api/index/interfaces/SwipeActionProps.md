[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / SwipeActionProps

# Interface: SwipeActionProps

Defined in: [js/src/components.ts:123](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L123)

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

Defined in: [js/src/components.ts:128](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L128)

***

### leadingSwipeActionSystemImage?

> `optional` **leadingSwipeActionSystemImage?**: `string`

Defined in: [js/src/components.ts:129](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L129)

***

### leadingSwipeActionTint?

> `optional` **leadingSwipeActionTint?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:130](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L130)

***

### onLeadingSwipeAction?

> `optional` **onLeadingSwipeAction?**: () => `void`

Defined in: [js/src/components.ts:131](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L131)

#### Returns

`void`

***

### onSwipeAction?

> `optional` **onSwipeAction?**: () => `void`

Defined in: [js/src/components.ts:127](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L127)

#### Returns

`void`

***

### swipeActionLabel?

> `optional` **swipeActionLabel?**: `string`

Defined in: [js/src/components.ts:124](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L124)

***

### swipeActionSystemImage?

> `optional` **swipeActionSystemImage?**: `string`

Defined in: [js/src/components.ts:125](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L125)

***

### swipeActionTint?

> `optional` **swipeActionTint?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:126](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L126)
