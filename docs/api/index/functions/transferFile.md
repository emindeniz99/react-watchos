[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / transferFile

# Function: transferFile()

> **transferFile**(`path`, `metadata?`): `Promise`\<[`FileTransferHandle`](../interfaces/FileTransferHandle.md)\>

Defined in: [js/src/connectivity.ts:199](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L199)

Queues a FILE for the paired iPhone (`WCSession.transferFile`) and resolves
**once queued**, with the id to track it by — not once delivered.

Delivery is deliberately not awaited. Apple throttles file transfers "to
accommodate performance and power concerns", the queue survives app
suspension, and a transfer can finish in a **later launch** — so an invoke
that waited for completion would blow its watchdog rather than report
anything useful. Completion arrives on [onFileTransfer](onFileTransfer.md) instead, and
may arrive in a process that never called this function.

`path` is a `file://` URL or an absolute container path this app can read.
`metadata` must contain property-list values only; a non-plist value fails
the transfer *later*, on the delegate, not here.

### Size and battery

Apple publishes no byte cap, but the radio is the dominant cost and the
system throttles. Ours, provisional and unmeasured: keep watch → phone
transfers **under ~1 MB**, never transfer from a render or sensor path, and
batch to an explicit user action or a background-refresh wake. Crossing the
soft cap emits a WARN `budget` diagnostic and still transfers — `WCError` is
the authority on what is actually too large. See
`docs/budgets-and-limits.md`.

## Parameters

### path

`string`

### metadata?

`Record`\<`string`, `unknown`\>

## Returns

`Promise`\<[`FileTransferHandle`](../interfaces/FileTransferHandle.md)\>
