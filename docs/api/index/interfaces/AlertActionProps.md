[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / AlertActionProps

# Interface: AlertActionProps

Defined in: [js/src/components.ts:620](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L620)

An action inside <Alert> / <ConfirmationDialog>. The system dismisses the
 presentation automatically when an action is tapped; `onPress` fires for
 the tapped action and the presentation's `onChange(false)` fires too.

## Extends

- `A11yProps`

## Properties

### accessibilityHint?

> `optional` **accessibilityHint?**: `string`

Defined in: [js/src/components.ts:76](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L76)

#### Inherited from

`A11yProps.accessibilityHint`

***

### accessibilityLabel?

> `optional` **accessibilityLabel?**: `string`

Defined in: [js/src/components.ts:75](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L75)

#### Inherited from

`A11yProps.accessibilityLabel`

***

### label

> **label**: `string`

Defined in: [js/src/components.ts:621](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L621)

***

### onPress?

> `optional` **onPress?**: () => `void`

Defined in: [js/src/components.ts:624](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L624)

#### Returns

`void`

***

### role?

> `optional` **role?**: `"destructive"` \| `"cancel"`

Defined in: [js/src/components.ts:623](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L623)

"destructive" renders red; "cancel" gets the cancel slot/placement.
