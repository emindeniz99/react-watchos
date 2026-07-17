[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / Diagnostic

# Interface: Diagnostic

Defined in: [js/src/diagnostics.ts:27](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/diagnostics.ts#L27)

## Properties

### code

> **code**: `string`

Defined in: [js/src/diagnostics.ts:29](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/diagnostics.ts#L29)

Stable machine code, dot-namespaced by subsystem (e.g. "ota.saveRejected").

***

### details?

> `optional` **details?**: `string`

Defined in: [js/src/diagnostics.ts:42](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/diagnostics.ts#L42)

Human-readable message.

***

### releaseId?

> `optional` **releaseId?**: `string`

Defined in: [js/src/diagnostics.ts:35](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/diagnostics.ts#L35)

Content hash of the booted bundle (CX-025); absent before load.

***

### sessionId

> **sessionId**: `string`

Defined in: [js/src/diagnostics.ts:33](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/diagnostics.ts#L33)

Fresh UUID per native boot — correlates one JS generation's records.

***

### severity

> **severity**: [`DiagnosticSeverity`](../type-aliases/DiagnosticSeverity.md)

Defined in: [js/src/diagnostics.ts:30](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/diagnostics.ts#L30)

***

### subsystem

> **subsystem**: [`DiagnosticSubsystem`](../type-aliases/DiagnosticSubsystem.md)

Defined in: [js/src/diagnostics.ts:31](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/diagnostics.ts#L31)

***

### target

> **target**: `"watch"` \| `"widget"`

Defined in: [js/src/diagnostics.ts:36](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/diagnostics.ts#L36)

***

### timestamp

> **timestamp**: `number`

Defined in: [js/src/diagnostics.ts:38](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/diagnostics.ts#L38)

Epoch milliseconds.

***

### userAction?

> `optional` **userAction?**: `string`

Defined in: [js/src/diagnostics.ts:40](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/diagnostics.ts#L40)

What the user can do about it. Reserved — absent in v1.
