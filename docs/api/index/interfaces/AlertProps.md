[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / AlertProps

# Interface: AlertProps

Defined in: [js/src/components.ts:665](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L665)

System alert (SwiftUI `.alert`), React-controlled like Toggle: you present
it with `presented`, the system dismisses it (action tap), and
`onChange(false)` tells React to drop its state. Children must be
<AlertAction> elements; with none, the system adds a default OK.

## Properties

### children?

> `optional` **children?**: `ReactNode`

Defined in: [js/src/components.ts:675](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L675)

***

### message?

> `optional` **message?**: `string`

Defined in: [js/src/components.ts:668](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L668)

***

### onChange?

> `optional` **onChange?**: (`presented`) => `void`

Defined in: [js/src/components.ts:674](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L674)

REQUIRED for the alert to actually present: without it React could never
observe the system's dismissal and the seq-ack would re-present forever,
so a handler-less presentation stays hidden (the controlled-input rule).

#### Parameters

##### presented

`boolean`

#### Returns

`void`

***

### presented?

> `optional` **presented?**: `boolean`

Defined in: [js/src/components.ts:666](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L666)

***

### title

> **title**: `string`

Defined in: [js/src/components.ts:667](https://github.com/emindeniz99/react-watchos/blob/main/js/src/components.ts#L667)
