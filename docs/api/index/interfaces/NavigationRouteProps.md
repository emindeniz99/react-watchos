[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / NavigationRouteProps

# Interface: NavigationRouteProps

Defined in: [js/src/components.ts:388](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L388)

## Extends

- `A11yProps`

## Properties

### accessibilityHidden?

> `optional` **accessibilityHidden?**: `boolean`

Defined in: [js/src/components.ts:100](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L100)

Hides this node and its whole subtree from VoiceOver (SwiftUI
`.accessibilityHidden(true)`, applied after label and hint, so it wins
over both). For purely decorative nodes such as a large quote mark or a
drop cap, which VoiceOver would otherwise read out as noise. Never set it
on anything interactive, or on a container holding interactive children:
a hidden control cannot be reached with VoiceOver at all.

#### Inherited from

`A11yProps.accessibilityHidden`

***

### accessibilityHint?

> `optional` **accessibilityHint?**: `string`

Defined in: [js/src/components.ts:91](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L91)

#### Inherited from

`A11yProps.accessibilityHint`

***

### accessibilityLabel?

> `optional` **accessibilityLabel?**: `string`

Defined in: [js/src/components.ts:90](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L90)

#### Inherited from

`A11yProps.accessibilityLabel`

***

### children?

> `optional` **children?**: `ReactNode`

Defined in: [js/src/components.ts:393](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L393)

***

### path

> **path**: `string`

Defined in: [js/src/components.ts:390](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L390)

Stable path for links, deep links, notifications, and tests.

***

### title?

> `optional` **title?**: `string`

Defined in: [js/src/components.ts:392](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L392)

Native navigation title when this route is displayed.
