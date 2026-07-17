[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / onRemotePushToken

# Function: onRemotePushToken()

> **onRemotePushToken**(`handler`): [`Unsubscribe`](../type-aliases/Unsubscribe.md)

Defined in: [js/src/remotePush.ts:74](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/remotePush.ts#L74)

Runs `handler` with the lowercase-hex device token whenever registration
succeeds — including a registration the app didn't await (a token rotation,
or a consumer's own native register call). Returns an unsubscribe.

## Parameters

### handler

(`token`) => `void`

## Returns

[`Unsubscribe`](../type-aliases/Unsubscribe.md)
