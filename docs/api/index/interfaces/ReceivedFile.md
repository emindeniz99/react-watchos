[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / ReceivedFile

# Interface: ReceivedFile

Defined in: [js/src/connectivity.ts:130](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L130)

A file received from the iPhone, as delivered to [onReceivedFile](../functions/onReceivedFile.md).

## Properties

### metadata

> **metadata**: `Record`\<`string`, `unknown`\>

Defined in: [js/src/connectivity.ts:155](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L155)

Whatever the sender passed as `metadata`; `{}` when it sent none.

***

### name

> **name**: `string`

Defined in: [js/src/connectivity.ts:152](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L152)

The name the sender gave the file.

***

### path

> **path**: `string`

Defined in: [js/src/connectivity.ts:150](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L150)

Absolute `file://` path inside this app's inbox. Read it with
 [readReceivedFile](../functions/readReceivedFile.md), then [deleteReceivedFile](../functions/deleteReceivedFile.md) it.

 `fetch(path)` → `arrayBuffer()` is **not** the way to read one, and each
 reason is a defect [readReceivedFile](../functions/readReceivedFile.md) exists to avoid:

 - **`fetch` reports failure on success.** A `file://` load is not an
   `HTTPURLResponse`, so the host reports `status: 0` — making
   `ok === false` and `statusText === "Server Error"` on a read that fully
   succeeded. (The `file://` leg itself is also still device-unverified:
   see `docs/design-platform-data-package.md` §"What is verified".)
 - **`fetch` cannot read a large file at all.** It caps a bridged body at
   5 MiB and `file://` honours no HTTP Range, so a bigger file — and the
   sending phone is under no matching cap — had no readable form.
   [readReceivedFile](../functions/readReceivedFile.md) bounds one CHUNK, not the file.
 - **`fetch` needs the `network` feature**, not `connectivity`, so a bundle
   policy-limited to `connectivity` received files it had no way to open.
   [readReceivedFile](../functions/readReceivedFile.md) is gated on `connectivity`, with the receive.

***

### receivedAt

> **receivedAt**: `number`

Defined in: [js/src/connectivity.ts:157](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L157)

ms since epoch, stamped when the file landed.

***

### size

> **size**: `number`

Defined in: [js/src/connectivity.ts:153](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L153)
