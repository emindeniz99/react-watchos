[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / NavigationStackProps

# Interface: NavigationStackProps

Defined in: [js/src/components.ts:351](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L351)

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

Defined in: [js/src/components.ts:367](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L367)

***

### onPathChange?

> `optional` **onPathChange?**: (`path`) => `void`

Defined in: [js/src/components.ts:366](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L366)

Fired when native back/link gestures propose a new stack path. In
controlled mode, fold it into `path` SYNCHRONOUSLY — setState inside the
handler is enough (the dispatch flushes it). Navigation is a confirmed
transaction (ARCH-09): a proposal the handler doesn't fold reads as
declined, and native won't navigate. Pops are notifications — native has
already popped — but must be folded the same way.

#### Parameters

##### path

`string`[]

#### Returns

`void`

***

### path?

> `optional` **path?**: `string`[]

Defined in: [js/src/components.ts:357](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L357)

Controlled native stack path. Root is represented by [] and pushed
routes are stable path strings such as ["/hydration"].

***

### title?

> `optional` **title?**: `string`

Defined in: [js/src/components.ts:352](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L352)
