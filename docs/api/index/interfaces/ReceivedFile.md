[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / ReceivedFile

# Interface: ReceivedFile

Defined in: [js/src/connectivity.ts:130](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L130)

A file received from the iPhone, as delivered to [onReceivedFile](../functions/onReceivedFile.md).

## Properties

### metadata

> **metadata**: `Record`\<`string`, `unknown`\>

Defined in: [js/src/connectivity.ts:138](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L138)

Whatever the sender passed as `metadata`; `{}` when it sent none.

***

### name

> **name**: `string`

Defined in: [js/src/connectivity.ts:135](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L135)

The name the sender gave the file.

***

### path

> **path**: `string`

Defined in: [js/src/connectivity.ts:133](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L133)

Absolute `file://`-readable path inside this app's inbox. Read it with
 `fetch(path)` → `arrayBuffer()`, then [deleteReceivedFile](../functions/deleteReceivedFile.md) it.

***

### receivedAt

> **receivedAt**: `number`

Defined in: [js/src/connectivity.ts:140](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L140)

ms since epoch, stamped when the file landed.

***

### size

> **size**: `number`

Defined in: [js/src/connectivity.ts:136](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L136)
