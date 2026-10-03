[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / SheetProps

# Interface: SheetProps

Defined in: [js/src/components.ts:693](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L693)

Modal sheet (SwiftUI `.sheet`; effectively full-screen on watchOS).
Controlled like <Alert>: present with `presented`, the user's swipe-down /
system dismissal fires `onChange(false)`. Children are the sheet content.

## Properties

### children?

> `optional` **children?**: `ReactNode`

Defined in: [js/src/components.ts:696](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L696)

***

### onChange?

> `optional` **onChange?**: (`presented`) => `void`

Defined in: [js/src/components.ts:695](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L695)

#### Parameters

##### presented

`boolean`

#### Returns

`void`

***

### presented?

> `optional` **presented?**: `boolean`

Defined in: [js/src/components.ts:694](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L694)
