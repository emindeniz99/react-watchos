[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / outstandingFileTransfers

# Function: outstandingFileTransfers()

> **outstandingFileTransfers**(): `Promise`\<[`FileTransferStatus`](../interfaces/FileTransferStatus.md)[]\>

Defined in: [js/src/connectivity.ts:261](https://github.com/emindeniz99/react-watchos/blob/main/js/src/connectivity.ts#L261)

Every transfer WCSession still has queued, including ones this launch did
 not queue (`id: null`). The polling counterpart to [onFileTransfer](onFileTransfer.md).

## Returns

`Promise`\<[`FileTransferStatus`](../interfaces/FileTransferStatus.md)[]\>
