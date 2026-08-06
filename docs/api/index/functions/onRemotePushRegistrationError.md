[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / onRemotePushRegistrationError

# Function: onRemotePushRegistrationError()

> **onRemotePushRegistrationError**(`handler`): [`Unsubscribe`](../type-aliases/Unsubscribe.md)

Defined in: [js/src/remotePush.ts:94](https://github.com/emindeniz99/react-watchos/blob/main/js/src/remotePush.ts#L94)

Runs `handler` with the native error message whenever APNs registration
fails (missing `aps-environment` entitlement, no network, sandbox
mismatch). The same failure also rejects the pending
[registerForRemoteNotifications](registerForRemoteNotifications.md) promise; this is for passive
observers. Returns an unsubscribe.

## Parameters

### handler

(`message`) => `void`

## Returns

[`Unsubscribe`](../type-aliases/Unsubscribe.md)
