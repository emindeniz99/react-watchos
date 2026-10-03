[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / GridRowProps

# Interface: GridRowProps

Defined in: [js/src/components.ts:722](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L722)

One row of a <Grid>; each child is a cell.

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

Defined in: [js/src/components.ts:723](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L723)
