[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / AlertActionProps

# Interface: AlertActionProps

Defined in: [js/src/components.ts:551](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L551)

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

Defined in: [js/src/components.ts:552](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L552)

***

### onPress?

> `optional` **onPress?**: () => `void`

Defined in: [js/src/components.ts:555](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L555)

#### Returns

`void`

***

### role?

> `optional` **role?**: `"destructive"` \| `"cancel"`

Defined in: [js/src/components.ts:554](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L554)

"destructive" renders red; "cancel" gets the cancel slot/placement.
