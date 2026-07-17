[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / AlertProps

# Interface: AlertProps

Defined in: [js/src/components.ts:532](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L532)

System alert (SwiftUI `.alert`), React-controlled like Toggle: you present
it with `presented`, the system dismisses it (action tap), and
`onChange(false)` tells React to drop its state. Children must be
<AlertAction> elements; with none, the system adds a default OK.

## Properties

### children?

> `optional` **children?**: `ReactNode`

Defined in: [js/src/components.ts:542](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L542)

***

### message?

> `optional` **message?**: `string`

Defined in: [js/src/components.ts:535](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L535)

***

### onChange?

> `optional` **onChange?**: (`presented`) => `void`

Defined in: [js/src/components.ts:541](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L541)

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

Defined in: [js/src/components.ts:533](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L533)

***

### title

> **title**: `string`

Defined in: [js/src/components.ts:534](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L534)
