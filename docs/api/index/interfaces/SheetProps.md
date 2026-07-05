[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / SheetProps

# Interface: SheetProps

Defined in: [js/src/components.ts:550](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L550)

Modal sheet (SwiftUI `.sheet`; effectively full-screen on watchOS).
Controlled like <Alert>: present with `presented`, the user's swipe-down /
system dismissal fires `onChange(false)`. Children are the sheet content.

## Properties

### children?

> `optional` **children?**: `ReactNode`

Defined in: [js/src/components.ts:553](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L553)

***

### onChange?

> `optional` **onChange?**: (`presented`) => `void`

Defined in: [js/src/components.ts:552](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L552)

#### Parameters

##### presented

`boolean`

#### Returns

`void`

***

### presented?

> `optional` **presented?**: `boolean`

Defined in: [js/src/components.ts:551](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L551)
