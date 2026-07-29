[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / onUserInfo

# Function: onUserInfo()

> **onUserInfo**(`handler`): [`Unsubscribe`](../type-aliases/Unsubscribe.md)

Defined in: [js/src/connectivity.ts:122](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L122)

Queued userInfo transfers from the iPhone, delivered in order (its
 `transferUserInfo`). Returns an unsubscribe. Every ITEM is delivered, but
 each is reduced to JSON — a `Date`/`Data` leaf the phone legitimately sent is
 dropped per-key and silently; see the inbound reduction note at the top of
 this module.

## Parameters

### handler

[`NativeEventHandler`](../type-aliases/NativeEventHandler.md)

## Returns

[`Unsubscribe`](../type-aliases/Unsubscribe.md)
