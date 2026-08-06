[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / AlertActionProps

# Interface: AlertActionProps

Defined in: [js/src/components.ts:534](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L534)

An action inside <Alert> / <ConfirmationDialog>. The system dismisses the
 presentation automatically when an action is tapped; `onPress` fires for
 the tapped action and the presentation's `onChange(false)` fires too.

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

### label

> **label**: `string`

Defined in: [js/src/components.ts:535](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L535)

***

### onPress?

> `optional` **onPress?**: () => `void`

Defined in: [js/src/components.ts:538](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L538)

#### Returns

`void`

***

### role?

> `optional` **role?**: `"destructive"` \| `"cancel"`

Defined in: [js/src/components.ts:537](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L537)

"destructive" renders red; "cancel" gets the cancel slot/placement.
