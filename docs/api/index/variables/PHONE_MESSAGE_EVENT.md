[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / PHONE\_MESSAGE\_EVENT

# Variable: PHONE\_MESSAGE\_EVENT

> `const` **PHONE\_MESSAGE\_EVENT**: `"watchConnectivity"` = `"watchConnectivity"`

Defined in: [js/src/connectivity.ts:27](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L27)

Phone <-> watch messaging over WatchConnectivity, surfaced through the
native-event channel and SPLIT by delivery semantics (ARCH-12) — the three
channels carry different guarantees and a merged stream forced JS to guess
which one fired:

| channel                | direction guarantees                                  |
|------------------------|-------------------------------------------------------|
| `sendToPhone` /        | interactive: needs the phone REACHABLE now; resolves  |
| [onPhoneMessage](../functions/onPhoneMessage.md) | the phone's reply                                      |
| [updateApplicationContext](../functions/updateApplicationContext.md) / [onApplicationContext](../functions/onApplicationContext.md) | latest-wins state: the counterpart gets the MOST RECENT context when it next wakes |
| [transferUserInfo](../functions/transferUserInfo.md) / [onUserInfo](../functions/onUserInfo.md) | FIFO queue: every item delivered in order, queue survives suspension |
| [transferFile](../functions/transferFile.md) / [onReceivedFile](../functions/onReceivedFile.md) | FIFO queue of FILES: the payload is a file on disk, not a plist — see [transferFile](../functions/transferFile.md) |

Rule of thumb: request/reply → sendToPhone; "current state" sync (settings,
dashboard data) → updateApplicationContext; must-not-drop event streams
(logged workouts, purchases) → transferUserInfo; bytes that aren't a
property list (an audio clip, an export, an image) → transferFile.
