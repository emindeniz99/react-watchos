[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / FileTransferResult

# Interface: FileTransferResult

Defined in: [js/src/connectivity.ts:197](https://github.com/emindeniz99/react-watchos/blob/main/js/src/connectivity.ts#L197)

The terminal state of one outbound [transferFile](../functions/transferFile.md).

## Properties

### code?

> `optional` **code?**: `string`

Defined in: [js/src/connectivity.ts:206](https://github.com/emindeniz99/react-watchos/blob/main/js/src/connectivity.ts#L206)

The `WCError.Code` case name (e.g. `"insufficientSpace"`), when the
 failure was one — so a caller can branch without parsing `error`.

***

### error?

> `optional` **error?**: `string`

Defined in: [js/src/connectivity.ts:203](https://github.com/emindeniz99/react-watchos/blob/main/js/src/connectivity.ts#L203)

Native failure message; absent when `state` is `"finished"`.

***

### id

> **id**: `number` \| `null`

Defined in: [js/src/connectivity.ts:200](https://github.com/emindeniz99/react-watchos/blob/main/js/src/connectivity.ts#L200)

The id [transferFile](../functions/transferFile.md) resolved, or `null` for a transfer queued by
 a previous launch (see [FileTransferStatus.id](FileTransferStatus.md#id)).

***

### state

> **state**: `"failed"` \| `"finished"`

Defined in: [js/src/connectivity.ts:201](https://github.com/emindeniz99/react-watchos/blob/main/js/src/connectivity.ts#L201)
