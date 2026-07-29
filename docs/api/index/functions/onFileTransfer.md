[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / onFileTransfer

# Function: onFileTransfer()

> **onFileTransfer**(`handler`): [`Unsubscribe`](../type-aliases/Unsubscribe.md)

Defined in: [js/src/connectivity.ts:291](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L291)

Runs `handler` when an outbound [transferFile](transferFile.md) finishes or fails —
possibly in a launch that never queued it (`id: null`). Returns an
unsubscribe.

## Parameters

### handler

(`result`) => `void`

## Returns

[`Unsubscribe`](../type-aliases/Unsubscribe.md)
