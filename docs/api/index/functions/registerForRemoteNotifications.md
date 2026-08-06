[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / registerForRemoteNotifications

# Function: registerForRemoteNotifications()

> **registerForRemoteNotifications**(): `Promise`\<`string`\>

Defined in: [js/src/remotePush.ts:49](https://github.com/emindeniz99/react-watchos/blob/main/js/src/remotePush.ts#L49)

Registers this launch with APNs and resolves the watch's device token as
lowercase hex — send it to your push server. Tokens are variable length and
can change between launches, so call this EVERY launch (never cache across
launches) and update the server with the fresh value; re-registration is
cheap. Rejects with an import("./invoke").InvokeError `UNAVAILABLE`
when there's no push-capable host (tests/widget) or registration fails
natively (e.g. a missing `aps-environment` entitlement — see the plugin's
`push: true` option). Registration isn't user-mediated (no permission
sheet), so the default 30 s invoke watchdog applies.

## Returns

`Promise`\<`string`\>
