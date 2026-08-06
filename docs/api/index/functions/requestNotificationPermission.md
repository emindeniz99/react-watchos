[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / requestNotificationPermission

# Function: requestNotificationPermission()

> **requestNotificationPermission**(): `Promise`\<`NotificationPermission`\>

Defined in: [js/src/notifications.ts:49](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/notifications.ts#L49)

Asks the user for notification permission (first call shows the prompt) and
resolves the resulting authorization status (CX-022). Resolves `"unavailable"`
when there's no notification-capable host (tests/widget); rejects only if the
native request itself errors. Routed through the generic invoke channel.

## Returns

`Promise`\<`NotificationPermission`\>
