[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / Diagnostic

# Interface: Diagnostic

Defined in: [js/src/diagnostics.ts:28](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/diagnostics.ts#L28)

## Properties

### code

> **code**: `string`

Defined in: [js/src/diagnostics.ts:30](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/diagnostics.ts#L30)

Stable machine code, dot-namespaced by subsystem (e.g. "ota.saveRejected").

***

### details?

> `optional` **details?**: `string`

Defined in: [js/src/diagnostics.ts:43](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/diagnostics.ts#L43)

Human-readable message.

***

### releaseId?

> `optional` **releaseId?**: `string`

Defined in: [js/src/diagnostics.ts:36](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/diagnostics.ts#L36)

Content hash of the booted bundle (CX-025); absent before load.

***

### sessionId

> **sessionId**: `string`

Defined in: [js/src/diagnostics.ts:34](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/diagnostics.ts#L34)

Fresh UUID per native boot — correlates one JS generation's records.

***

### severity

> **severity**: [`DiagnosticSeverity`](../type-aliases/DiagnosticSeverity.md)

Defined in: [js/src/diagnostics.ts:31](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/diagnostics.ts#L31)

***

### subsystem

> **subsystem**: [`DiagnosticSubsystem`](../type-aliases/DiagnosticSubsystem.md)

Defined in: [js/src/diagnostics.ts:32](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/diagnostics.ts#L32)

***

### target

> **target**: `"watch"` \| `"widget"`

Defined in: [js/src/diagnostics.ts:37](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/diagnostics.ts#L37)

***

### timestamp

> **timestamp**: `number`

Defined in: [js/src/diagnostics.ts:39](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/diagnostics.ts#L39)

Epoch milliseconds.

***

### userAction?

> `optional` **userAction?**: `string`

Defined in: [js/src/diagnostics.ts:41](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/diagnostics.ts#L41)

What the user can do about it. Reserved — absent in v1.
