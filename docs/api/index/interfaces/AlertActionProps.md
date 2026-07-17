[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / AlertActionProps

# Interface: AlertActionProps

Defined in: [js/src/components.ts:519](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L519)

An action inside <Alert> / <ConfirmationDialog>. The system dismisses the
 presentation automatically when an action is tapped; `onPress` fires for
 the tapped action and the presentation's `onChange(false)` fires too.

## Extends

- `A11yProps`

## Properties

### accessibilityHint?

> `optional` **accessibilityHint?**: `string`

Defined in: [js/src/components.ts:53](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L53)

#### Inherited from

`A11yProps.accessibilityHint`

***

### accessibilityLabel?

> `optional` **accessibilityLabel?**: `string`

Defined in: [js/src/components.ts:52](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L52)

#### Inherited from

`A11yProps.accessibilityLabel`

***

### label

> **label**: `string`

Defined in: [js/src/components.ts:520](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L520)

***

### onPress?

> `optional` **onPress?**: () => `void`

Defined in: [js/src/components.ts:523](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L523)

#### Returns

`void`

***

### role?

> `optional` **role?**: `"destructive"` \| `"cancel"`

Defined in: [js/src/components.ts:522](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L522)

"destructive" renders red; "cancel" gets the cancel slot/placement.
