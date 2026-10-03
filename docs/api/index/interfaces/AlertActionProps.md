[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / AlertActionProps

# Interface: AlertActionProps

Defined in: [js/src/components.ts:642](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L642)

An action inside <Alert> / <ConfirmationDialog>. The system dismisses the
 presentation automatically when an action is tapped; `onPress` fires for
 the tapped action and the presentation's `onChange(false)` fires too.

## Extends

- `A11yProps`

## Properties

### accessibilityHint?

> `optional` **accessibilityHint?**: `string`

Defined in: [js/src/components.ts:90](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L90)

#### Inherited from

`A11yProps.accessibilityHint`

***

### accessibilityLabel?

> `optional` **accessibilityLabel?**: `string`

Defined in: [js/src/components.ts:89](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L89)

#### Inherited from

`A11yProps.accessibilityLabel`

***

### label

> **label**: `string`

Defined in: [js/src/components.ts:643](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L643)

***

### onPress?

> `optional` **onPress?**: () => `void`

Defined in: [js/src/components.ts:646](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L646)

#### Returns

`void`

***

### role?

> `optional` **role?**: `"destructive"` \| `"cancel"`

Defined in: [js/src/components.ts:645](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L645)

"destructive" renders red; "cancel" gets the cancel slot/placement.
