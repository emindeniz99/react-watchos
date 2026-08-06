[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / SheetProps

# Interface: SheetProps

Defined in: [js/src/components.ts:574](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L574)

Modal sheet (SwiftUI `.sheet`; effectively full-screen on watchOS).
Controlled like <Alert>: present with `presented`, the user's swipe-down /
system dismissal fires `onChange(false)`. Children are the sheet content.

## Properties

### children?

> `optional` **children?**: `ReactNode`

Defined in: [js/src/components.ts:577](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L577)

***

### onChange?

> `optional` **onChange?**: (`presented`) => `void`

Defined in: [js/src/components.ts:576](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L576)

#### Parameters

##### presented

`boolean`

#### Returns

`void`

***

### presented?

> `optional` **presented?**: `boolean`

Defined in: [js/src/components.ts:575](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L575)
