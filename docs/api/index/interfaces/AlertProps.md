[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / AlertProps

# Interface: AlertProps

Defined in: [js/src/components.ts:547](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L547)

System alert (SwiftUI `.alert`), React-controlled like Toggle: you present
it with `presented`, the system dismisses it (action tap), and
`onChange(false)` tells React to drop its state. Children must be
<AlertAction> elements; with none, the system adds a default OK.

## Properties

### children?

> `optional` **children?**: `ReactNode`

Defined in: [js/src/components.ts:557](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L557)

***

### message?

> `optional` **message?**: `string`

Defined in: [js/src/components.ts:550](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L550)

***

### onChange?

> `optional` **onChange?**: (`presented`) => `void`

Defined in: [js/src/components.ts:556](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L556)

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

Defined in: [js/src/components.ts:548](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L548)

***

### title

> **title**: `string`

Defined in: [js/src/components.ts:549](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/components.ts#L549)
