[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / FileTransferResult

# Interface: FileTransferResult

Defined in: [js/src/connectivity.ts:144](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L144)

The terminal state of one outbound [transferFile](../functions/transferFile.md).

## Properties

### code?

> `optional` **code?**: `string`

Defined in: [js/src/connectivity.ts:153](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L153)

The `WCError.Code` case name (e.g. `"insufficientSpace"`), when the
 failure was one — so a caller can branch without parsing `error`.

***

### error?

> `optional` **error?**: `string`

Defined in: [js/src/connectivity.ts:150](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L150)

Native failure message; absent when `state` is `"finished"`.

***

### id

> **id**: `number` \| `null`

Defined in: [js/src/connectivity.ts:147](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L147)

The id [transferFile](../functions/transferFile.md) resolved, or `null` for a transfer queued by
 a previous launch (see [FileTransferStatus.id](FileTransferStatus.md#id)).

***

### state

> **state**: `"failed"` \| `"finished"`

Defined in: [js/src/connectivity.ts:148](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L148)
