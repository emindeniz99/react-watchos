[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / REMOTE\_PUSH\_EVENT

# Variable: REMOTE\_PUSH\_EVENT

> `const` **REMOTE\_PUSH\_EVENT**: `"remotePush"` = `"remotePush"`

Defined in: [js/src/remotePush.ts:12](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/remotePush.ts#L12)

Remote push notifications (APNs). The watch receives its OWN device token —
for a standalone-capable app, servers should send to BOTH the watch token
and the paired-iPhone token (the system dedupes). Alert pushes need
notification permission ([requestNotificationPermission](../functions/requestNotificationPermission.md)) or they are
delivered silently; background (`content-available`) pushes wake the app
subject to the system's budget and arrive on [onRemotePush](../functions/onRemotePush.md).
