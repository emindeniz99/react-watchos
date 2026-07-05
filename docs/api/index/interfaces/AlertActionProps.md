[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / AlertActionProps

# Interface: AlertActionProps

Defined in: [js/src/components.ts:510](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L510)

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

Defined in: [js/src/components.ts:511](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L511)

***

### onPress?

> `optional` **onPress?**: () => `void`

Defined in: [js/src/components.ts:514](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L514)

#### Returns

`void`

***

### role?

> `optional` **role?**: `"destructive"` \| `"cancel"`

Defined in: [js/src/components.ts:513](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L513)

"destructive" renders red; "cancel" gets the cancel slot/placement.
