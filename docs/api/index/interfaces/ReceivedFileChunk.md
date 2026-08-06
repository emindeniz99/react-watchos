[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / ReceivedFileChunk

# Interface: ReceivedFileChunk

Defined in: [js/src/connectivity.ts:295](https://github.com/emindeniz99/react-watchos/blob/main/js/src/connectivity.ts#L295)

One chunk of a received file, as [readReceivedFile](../functions/readReceivedFile.md) resolves it.

## Properties

### base64

> **base64**: `string`

Defined in: [js/src/connectivity.ts:299](https://github.com/emindeniz99/react-watchos/blob/main/js/src/connectivity.ts#L299)

Base64 of this chunk's bytes. Successive chunks **concatenate**: the host
 trims a chunk that does not end the file to a multiple of 3 bytes, so
 `atob(a + b + c)` is the file — no per-chunk decode-and-join needed.

***

### bytes

> **bytes**: `number`

Defined in: [js/src/connectivity.ts:304](https://github.com/emindeniz99/react-watchos/blob/main/js/src/connectivity.ts#L304)

Decoded byte count of THIS chunk. Authoritative: add it to `offset` for
 the next read. The `length` you asked for is not — the host clamps it
 against the end of the file, the chunk ceiling, and the multiple-of-3 trim
 above, so a non-final chunk is up to 2 bytes shorter than requested.

***

### eof

> **eof**: `boolean`

Defined in: [js/src/connectivity.ts:310](https://github.com/emindeniz99/react-watchos/blob/main/js/src/connectivity.ts#L310)

True when this chunk ends the file.

***

### offset

> **offset**: `number`

Defined in: [js/src/connectivity.ts:306](https://github.com/emindeniz99/react-watchos/blob/main/js/src/connectivity.ts#L306)

Byte offset this chunk starts at.

***

### totalBytes

> **totalBytes**: `number`

Defined in: [js/src/connectivity.ts:308](https://github.com/emindeniz99/react-watchos/blob/main/js/src/connectivity.ts#L308)

The whole file's size, so a loop knows where it is going.
