[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / onReceivedFile

# Function: onReceivedFile()

> **onReceivedFile**(`handler`): [`Unsubscribe`](../type-aliases/Unsubscribe.md)

Defined in: [js/src/connectivity.ts:379](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L379)

Runs `handler` for each file the iPhone sends. The file has already been
moved out of the system's temporary directory into this app's inbox (native
must do that synchronously or the system deletes it), so `path` is live when
your handler runs. Returns an unsubscribe.

**It is not yours forever.** The inbox keeps the newest 32 files / 7 days and
prunes on every receive, exactly as [deleteReceivedFile](deleteReceivedFile.md) describes.
Native will not delete a file whose event has not reached you yet — that is
guaranteed — but once this handler returns, the next burst of arrivals can
reclaim it. Copy the bytes out if you need them past the current burst, and
call [deleteReceivedFile](deleteReceivedFile.md) when you are done.

## Parameters

### handler

(`file`) => `void`

## Returns

[`Unsubscribe`](../type-aliases/Unsubscribe.md)
