[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / ReceivedFile

# Interface: ReceivedFile

Defined in: [js/src/connectivity.ts:130](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L130)

A file received from the iPhone, as delivered to [onReceivedFile](../functions/onReceivedFile.md).

## Properties

### metadata

> **metadata**: `Record`\<`string`, `unknown`\>

Defined in: [js/src/connectivity.ts:156](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L156)

Whatever the sender passed as `metadata`; `{}` when it sent none.

***

### name

> **name**: `string`

Defined in: [js/src/connectivity.ts:153](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L153)

The name the sender gave the file.

***

### path

> **path**: `string`

Defined in: [js/src/connectivity.ts:151](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L151)

Absolute `file://` path inside this app's inbox. Read it with
 `fetch(path)` → `arrayBuffer()`, then [deleteReceivedFile](../functions/deleteReceivedFile.md) it —
 with three caveats. (The `file://` leg itself is still device-unverified:
 see `docs/design-platform-data-package.md` §"What is verified".)

 - **Ignore `response.ok` and `response.status`.** A `file://` load is not
   an `HTTPURLResponse`, so the host reports `status: 0` — making
   `ok === false` and `statusText === "Server Error"` on a read that fully
   succeeded. `arrayBuffer()` still returns the bytes; a rejected promise
   is the only real failure signal here.
 - **Over 5 MiB is unreadable.** The host caps a bridged body at
   `FetchResponse.defaultMaxBodyBytes` and rejects past it, to keep an
   unbounded body out of the watch's tight QuickJS heap — and the sending
   phone is under no matching cap. Check [ReceivedFile.size](#size) first;
   `file://` honours no HTTP Range, so there is no chunked read and no
   other byte-reading API in this package.
 - **Reading needs the `network` feature**, not `connectivity`. `fetch` is
   gated separately, so a bundle policy-limited to `connectivity` receives
   files it has no way to open.

***

### receivedAt

> **receivedAt**: `number`

Defined in: [js/src/connectivity.ts:158](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L158)

ms since epoch, stamped when the file landed.

***

### size

> **size**: `number`

Defined in: [js/src/connectivity.ts:154](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L154)
