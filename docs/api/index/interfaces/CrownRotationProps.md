[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / CrownRotationProps

# Interface: CrownRotationProps

Defined in: [js/src/components.ts:487](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L487)

Binds the Digital Crown to a numeric value over its children (SwiftUI
`digitalCrownRotation`). The wrapped view becomes crown-focusable;
rotating the Crown fires `onChange` with the new value. Use for volume,
zoom, scrubbing — anything the Crown should drive directly (vs. the
Crown's implicit role inside Picker/ScrollView). On a screen with more
than one Crown client, say which one owns the Crown with the `focused`
claim + `onFocusChange` observation pair.

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

Defined in: [js/src/components.ts:527](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L527)

***

### focused?

> `optional` **focused?**: `boolean`

Defined in: [js/src/components.ts:518](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L518)

Declarative Crown-focus claim. watchOS routes the Digital Crown to
exactly ONE focused view, so a screen with two `<CrownRotation>`s must
say which one owns it: derive the claim from state
(`focused={owner === "zoom"}`) and flip the state to hand the Crown
over. The claim applies when the committed value CHANGES and once when
the node APPEARS (so a pushed screen's marked Crown view grabs the
Crown automatically); `false` resigns focus.

Edge-triggered, not enforced: after it applies, the system keeps
arbitration — the user tapping the other Crown view legitimately moves
focus. Observe that with [onFocusChange](#onfocuschange) and fold it into the
state this claim derives from, or your state can go stale and a
re-claim has no edge to fire on. At most one node per screen should
claim `focused` (with several, exactly one wins but WHICH is
unspecified). Omit the prop entirely on single-Crown screens to keep
the system's own arbitration. Meaningless in widgets: CrownRotation is
degraded there (renders children only), so the prop is inert data.
Full model: docs/design-focus-management.md.

***

### haptic?

> `optional` **haptic?**: `boolean`

Defined in: [js/src/components.ts:496](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L496)

Crown haptic detents (default true).

***

### max?

> `optional` **max?**: `number`

Defined in: [js/src/components.ts:492](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L492)

Range upper bound (default 100).

***

### min?

> `optional` **min?**: `number`

Defined in: [js/src/components.ts:490](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L490)

Range lower bound (default 0).

***

### onChange?

> `optional` **onChange?**: (`value`) => `void`

Defined in: [js/src/components.ts:497](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L497)

#### Parameters

##### value

`number`

#### Returns

`void`

***

### onFocusChange?

> `optional` **onFocusChange?**: (`focused`) => `void`

Defined in: [js/src/components.ts:526](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L526)

Fired when Crown focus moves to (`true`) or away from (`false`) this
view — both when a focused claim lands and when the system
moves focus on its own (a tap on another Crown view). Fold it into the
state that derives `focused` to keep JS's picture of the Crown owner
truthful.

#### Parameters

##### focused

`boolean`

#### Returns

`void`

***

### step?

> `optional` **step?**: `number`

Defined in: [js/src/components.ts:494](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L494)

Detent size (default 1).

***

### value

> **value**: `number`

Defined in: [js/src/components.ts:488](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L488)
