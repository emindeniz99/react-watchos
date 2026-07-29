[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / onReceivedFile

# Function: onReceivedFile()

> **onReceivedFile**(`handler`): [`Unsubscribe`](../type-aliases/Unsubscribe.md)

Defined in: [js/src/connectivity.ts:241](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L241)

Runs `handler` for each file the iPhone sends. The file has already been
moved out of the system's temporary directory into this app's inbox (native
must do that synchronously or the system deletes it), so `path` is readable
for as long as you keep it. Returns an unsubscribe.

## Parameters

### handler

(`file`) => `void`

## Returns

[`Unsubscribe`](../type-aliases/Unsubscribe.md)
