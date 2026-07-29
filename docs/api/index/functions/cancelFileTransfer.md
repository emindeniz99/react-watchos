[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / cancelFileTransfer

# Function: cancelFileTransfer()

> **cancelFileTransfer**(`id`): `Promise`\<`void`\>

Defined in: [js/src/connectivity.ts:220](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L220)

Cancels a queued/in-flight transfer by the id [transferFile](transferFile.md) resolved.
Rejects `INVALID_REQUEST` when this launch never minted that id — including
for a transfer queued by a previous launch, which has no id to cancel by.

Cancelling an id this launch DID mint always resolves, even if the transfer
already completed — Apple defines `cancel()` on a transferred file as having
"no effect", and the completion races the cancel by nature (it arrives on
[onFileTransfer](onFileTransfer.md), not here). Await [onFileTransfer](onFileTransfer.md) for the
terminal state; this resolving does not mean the transfer was stopped.

## Parameters

### id

`number`

## Returns

`Promise`\<`void`\>
