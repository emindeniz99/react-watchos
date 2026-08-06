[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / onBackgroundRefresh

# Function: onBackgroundRefresh()

> **onBackgroundRefresh**(`handler`): [`Unsubscribe`](../type-aliases/Unsubscribe.md)

Defined in: [js/src/background.ts:36](https://github.com/emindeniz99/react-watchos/blob/main/js/src/background.ts#L36)

Runs `handler` when a scheduled background refresh fires (`{ userInfo }`).
Keep the work short — the app suspends again when it returns. Returns an
unsubscribe.

## Parameters

### handler

[`NativeEventHandler`](../type-aliases/NativeEventHandler.md)

## Returns

[`Unsubscribe`](../type-aliases/Unsubscribe.md)
