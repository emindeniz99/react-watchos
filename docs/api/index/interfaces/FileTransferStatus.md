[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / FileTransferStatus

# Interface: FileTransferStatus

Defined in: [js/src/connectivity.ts:102](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L102)

One entry of [outstandingFileTransfers](../functions/outstandingFileTransfers.md).

## Properties

### fractionCompleted

> **fractionCompleted**: `number`

Defined in: [js/src/connectivity.ts:115](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L115)

0–1 (`WCSessionFileTransfer.progress`). Poll this; there is deliberately
 no progress push channel — a KVO observer per transfer pushing at an
 unbounded rate is the wakeup anti-pattern
 `docs/perf-battery-audit-2026-07-08.md` §P1-1 measures.

***

### id?

> `optional` **id?**: `number`

Defined in: [js/src/connectivity.ts:107](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L107)

`null` for a transfer queued by a PREVIOUS launch: the id space is this
 launch's, and `WCSessionFileTransfer` carries no identity of its own, so
 there is nothing honest to report. Such a transfer still completes and
 still fires [onFileTransfer](../functions/onFileTransfer.md) — with `id: null`.

***

### name

> **name**: `string`

Defined in: [js/src/connectivity.ts:109](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L109)

Last path component of the file being sent.

***

### transferring

> **transferring**: `boolean`

Defined in: [js/src/connectivity.ts:110](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L110)
