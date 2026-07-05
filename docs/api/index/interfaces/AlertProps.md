[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / AlertProps

# Interface: AlertProps

Defined in: [js/src/components.ts:515](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L515)

System alert (SwiftUI `.alert`), React-controlled like Toggle: you present
it with `presented`, the system dismisses it (action tap), and
`onChange(false)` tells React to drop its state. Children must be
<AlertAction> elements; with none, the system adds a default OK.

## Properties

### children?

> `optional` **children?**: `ReactNode`

Defined in: [js/src/components.ts:525](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L525)

***

### message?

> `optional` **message?**: `string`

Defined in: [js/src/components.ts:518](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L518)

***

### onChange?

> `optional` **onChange?**: (`presented`) => `void`

Defined in: [js/src/components.ts:524](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L524)

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

Defined in: [js/src/components.ts:516](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L516)

***

### title

> **title**: `string`

Defined in: [js/src/components.ts:517](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L517)
