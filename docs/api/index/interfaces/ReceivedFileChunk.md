[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / ReceivedFileChunk

# Interface: ReceivedFileChunk

Defined in: [js/src/connectivity.ts:259](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L259)

One chunk of a received file, as [readReceivedFile](../functions/readReceivedFile.md) resolves it.

## Properties

### base64

> **base64**: `string`

Defined in: [js/src/connectivity.ts:263](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L263)

Base64 of this chunk's bytes. Successive chunks **concatenate**: the host
 trims a chunk that does not end the file to a multiple of 3 bytes, so
 `atob(a + b + c)` is the file — no per-chunk decode-and-join needed.

***

### bytes

> **bytes**: `number`

Defined in: [js/src/connectivity.ts:267](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L267)

Decoded byte count of THIS chunk. Authoritative: add it to `offset` for
 the next read. The `length` you asked for is not — the host clamps it
 against the end of the file and the chunk ceiling.

***

### eof

> **eof**: `boolean`

Defined in: [js/src/connectivity.ts:273](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L273)

True when this chunk ends the file.

***

### offset

> **offset**: `number`

Defined in: [js/src/connectivity.ts:269](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L269)

Byte offset this chunk starts at.

***

### totalBytes

> **totalBytes**: `number`

Defined in: [js/src/connectivity.ts:271](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L271)

The whole file's size, so a loop knows where it is going.
