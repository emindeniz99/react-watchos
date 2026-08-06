[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / onRemotePushToken

# Function: onRemotePushToken()

> **onRemotePushToken**(`handler`): [`Unsubscribe`](../type-aliases/Unsubscribe.md)

Defined in: [js/src/remotePush.ts:79](https://github.com/emindeniz99/react-watchos/blob/main/js/src/remotePush.ts#L79)

Runs `handler` with the lowercase-hex device token whenever registration
succeeds — including a registration the app didn't await (a token rotation,
or a consumer's own native register call). Returns an unsubscribe.

## Parameters

### handler

(`token`) => `void`

## Returns

[`Unsubscribe`](../type-aliases/Unsubscribe.md)
