[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / cancelFileTransfer

# Function: cancelFileTransfer()

> **cancelFileTransfer**(`id`): `Promise`\<`void`\>

Defined in: [js/src/connectivity.ts:196](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L196)

Cancels a queued/in-flight transfer by the id [transferFile](transferFile.md) resolved.
Rejects `INVALID_REQUEST` when this launch never minted that id — including
for a transfer queued by a previous launch, which has no id to cancel by.

## Parameters

### id

`number`

## Returns

`Promise`\<`void`\>
