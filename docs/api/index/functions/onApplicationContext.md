[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / onApplicationContext

# Function: onApplicationContext()

> **onApplicationContext**(`handler`): [`Unsubscribe`](../type-aliases/Unsubscribe.md)

Defined in: [js/src/connectivity.ts:113](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L113)

Latest-wins context pushed from the iPhone (its `updateApplicationContext`).
 Returns an unsubscribe. The payload is reduced to JSON — a `Date`/`Data` leaf
 the phone legitimately sent is dropped per-key and silently; see the inbound
 reduction note at the top of this module.

## Parameters

### handler

[`NativeEventHandler`](../type-aliases/NativeEventHandler.md)

## Returns

[`Unsubscribe`](../type-aliases/Unsubscribe.md)
