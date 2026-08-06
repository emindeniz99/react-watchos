[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / onPhoneMessage

# Function: onPhoneMessage()

> **onPhoneMessage**(`handler`): [`Unsubscribe`](../type-aliases/Unsubscribe.md)

Defined in: [js/src/connectivity.ts:78](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L78)

Registers a handler for messages pushed from the iPhone. Returns an
 unsubscribe. The payload is reduced to JSON — a `Date`/`Data` leaf the phone
 legitimately sent is dropped per-key and silently; see the inbound reduction
 note at the top of this module.

## Parameters

### handler

[`NativeEventHandler`](../type-aliases/NativeEventHandler.md)

## Returns

[`Unsubscribe`](../type-aliases/Unsubscribe.md)
