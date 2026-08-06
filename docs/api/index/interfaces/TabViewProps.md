[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / TabViewProps

# Interface: TabViewProps

Defined in: [js/src/components.ts:356](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L356)

## Extends

- `A11yProps`

## Properties

### accessibilityHint?

> `optional` **accessibilityHint?**: `string`

Defined in: [js/src/components.ts:53](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L53)

#### Inherited from

`A11yProps.accessibilityHint`

***

### accessibilityLabel?

> `optional` **accessibilityLabel?**: `string`

Defined in: [js/src/components.ts:52](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L52)

#### Inherited from

`A11yProps.accessibilityLabel`

***

### children?

> `optional` **children?**: `ReactNode`

Defined in: [js/src/components.ts:358](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L358)

Each child is one page.

***

### onChange?

> `optional` **onChange?**: (`index`) => `void`

Defined in: [js/src/components.ts:369](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L369)

Fires with the new page index as the user swipes between pages.

#### Parameters

##### index

`number`

#### Returns

`void`

***

### selection?

> `optional` **selection?**: `number`

Defined in: [js/src/components.ts:367](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L367)

Controlled selected page index (0-based). When set, the native TabView
binds to it optimistically (a swipe holds until React acks) — keep it in
state and update it from `onChange`, or the page snaps back. Omit both
for the uncontrolled TabView. A controlled TabView without `onChange` is
read-only — swiping is disabled, the same CX-010 rule as every other
controlled input.
