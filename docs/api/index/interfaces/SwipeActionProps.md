[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / SwipeActionProps

# Interface: SwipeActionProps

Defined in: [js/src/components.ts:132](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L132)

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

Defined in: [js/src/components.ts:137](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L137)

***

### leadingSwipeActionSystemImage?

> `optional` **leadingSwipeActionSystemImage?**: `string`

Defined in: [js/src/components.ts:138](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L138)

***

### leadingSwipeActionTint?

> `optional` **leadingSwipeActionTint?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:139](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L139)

***

### onLeadingSwipeAction?

> `optional` **onLeadingSwipeAction?**: () => `void`

Defined in: [js/src/components.ts:140](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L140)

#### Returns

`void`

***

### onSwipeAction?

> `optional` **onSwipeAction?**: () => `void`

Defined in: [js/src/components.ts:136](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L136)

#### Returns

`void`

***

### swipeActionLabel?

> `optional` **swipeActionLabel?**: `string`

Defined in: [js/src/components.ts:133](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L133)

***

### swipeActionSystemImage?

> `optional` **swipeActionSystemImage?**: `string`

Defined in: [js/src/components.ts:134](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L134)

***

### swipeActionTint?

> `optional` **swipeActionTint?**: [`ColorValue`](../type-aliases/ColorValue.md)

Defined in: [js/src/components.ts:135](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L135)
