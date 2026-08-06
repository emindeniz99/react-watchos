[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / deleteReceivedFile

# Function: deleteReceivedFile()

> **deleteReceivedFile**(`path`): `Promise`\<`void`\>

Defined in: [js/src/connectivity.ts:290](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L290)

Deletes a file this app received, by the `path` its
[onReceivedFile](onReceivedFile.md) event carried. Call it once you've read the bytes.

The inbox is also pruned natively on each receive (newest 32 files / 7 days),
but pruning alone would delete files an app is still holding a path to —
hence an explicit release. Rejects `INVALID_REQUEST` for a path outside the
inbox; resolves for a path that is already gone (deleting twice is not an
error).

## Parameters

### path

`string`

## Returns

`Promise`\<`void`\>
