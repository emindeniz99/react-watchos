[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [testing](../README.md) / mountApp

# Function: mountApp()

> **mountApp**(`element`, `host?`): [`WatchRoot`](../../index/classes/WatchRoot.md)

Defined in: [js/src/testing.ts:74](https://github.com/emindeniz99/react-watchos/blob/main/js/src/testing.ts#L74)

`runApp` for tests: the root is tracked so `resetApp` disposes it — without
this, the second test in a file hits `runApp`'s single-active-root guard
("a root is already mounted"). Pair with `afterEach(resetApp)`.

## Parameters

### element

`ReactNode`

### host?

[`HostBridge`](../../index/interfaces/HostBridge.md)

## Returns

[`WatchRoot`](../../index/classes/WatchRoot.md)
