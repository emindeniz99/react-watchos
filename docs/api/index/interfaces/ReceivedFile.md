[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / ReceivedFile

# Interface: ReceivedFile

Defined in: [js/src/connectivity.ts:162](https://github.com/emindeniz99/react-watchos/blob/main/js/src/connectivity.ts#L162)

A file received from the iPhone, as delivered to [onReceivedFile](../functions/onReceivedFile.md).

## Properties

### metadata

> **metadata**: `Record`\<`string`, `unknown`\>

Defined in: [js/src/connectivity.ts:191](https://github.com/emindeniz99/react-watchos/blob/main/js/src/connectivity.ts#L191)

What the sender passed as `metadata`, REDUCED TO JSON — see the inbound
 reduction note at the top of this module. A `Date`/`Data`/non-finite leaf
 the sender legitimately put in this property list is dropped per-key and
 silently, so a key it set can be missing here, and `{}` means EITHER "sent
 none" OR "every value was unbridgeable".

***

### name

> **name**: `string`

Defined in: [js/src/connectivity.ts:184](https://github.com/emindeniz99/react-watchos/blob/main/js/src/connectivity.ts#L184)

The name the sender gave the file.

***

### path

> **path**: `string`

Defined in: [js/src/connectivity.ts:182](https://github.com/emindeniz99/react-watchos/blob/main/js/src/connectivity.ts#L182)

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

Defined in: [js/src/connectivity.ts:193](https://github.com/emindeniz99/react-watchos/blob/main/js/src/connectivity.ts#L193)

ms since epoch, stamped when the file landed.

***

### size

> **size**: `number`

Defined in: [js/src/connectivity.ts:185](https://github.com/emindeniz99/react-watchos/blob/main/js/src/connectivity.ts#L185)
