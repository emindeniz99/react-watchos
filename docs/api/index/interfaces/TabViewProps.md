[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / TabViewProps

# Interface: TabViewProps

Defined in: [js/src/components.ts:358](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L358)

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

Defined in: [js/src/components.ts:360](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L360)

Each child is one page.

***

### onChange?

> `optional` **onChange?**: (`index`) => `void`

Defined in: [js/src/components.ts:371](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L371)

Fires with the new page index as the user swipes between pages.

#### Parameters

##### index

`number`

#### Returns

`void`

***

### selection?

> `optional` **selection?**: `number`

Defined in: [js/src/components.ts:369](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L369)

Controlled selected page index (0-based). When set, the native TabView
binds to it optimistically (a swipe holds until React acks) — keep it in
state and update it from `onChange`, or the page snaps back. Omit both
for the uncontrolled TabView. A controlled TabView without `onChange` is
read-only — swiping is disabled, the same CX-010 rule as every other
controlled input.

***

### style?

> `optional` **style?**: `"page"` \| `"verticalPage"`

Defined in: [js/src/components.ts:388](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L388)

Which SwiftUI `TabViewStyle` to page with. Each value maps to the style
of the same name, so this prop means exactly what SwiftUI means:

- `verticalPage` — watchOS's crown-driven pager: one haptic detent per
  page, vertical swipes page too, and the page indicator sits on the
  trailing (crown) edge, mirrored automatically with the wearer's
  orientation setting, so the app never needs to know which side the
  crown is on.
- `page` — the horizontal pager with the bottom dots.

Omit it to keep SwiftUI's own default for the platform (today that is
the horizontal pager): the renderer is a thin binding layer, so an
absent prop applies no modifier rather than a style of our choosing.
`carousel` is deliberately NOT offered — SwiftUI deprecated it.
