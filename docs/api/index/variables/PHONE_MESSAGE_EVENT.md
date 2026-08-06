[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / PHONE\_MESSAGE\_EVENT

# Variable: PHONE\_MESSAGE\_EVENT

> `const` **PHONE\_MESSAGE\_EVENT**: `"watchConnectivity"` = `"watchConnectivity"`

Defined in: [js/src/connectivity.ts:47](https://github.com/emindeniz99/react-watchos/blob/main/js/src/connectivity.ts#L47)

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

### Everything INBOUND is reduced to JSON, per key and silently

Apple's contract for these channels is that the sender's dictionary holds
PROPERTY LIST values, and WatchConnectivity hands each delegate that
dictionary verbatim. A property list is a wider type than JSON, so a `Date`,
a `Data`, or a non-finite number is the sending iPhone using Apple's API
exactly as documented — and this bridge cannot carry it. The host DROPS such
a leaf and delivers the rest, rather than losing the whole payload.

That reduction applies to every inbound plist — [onPhoneMessage](../functions/onPhoneMessage.md),
[onApplicationContext](../functions/onApplicationContext.md), [onUserInfo](../functions/onUserInfo.md), [ReceivedFile.metadata](../interfaces/ReceivedFile.md#metadata),
and the reply [sendToPhone](../functions/sendToPhone.md) resolves — and it is **not reported**:
nothing rejects, no `onError`/diagnostic fires, and the key is simply absent,
indistinguishable from one the sender never set. A container is reduced, never
dropped, so an all-unbridgeable object/array arrives as `{}`/`[]`.

Send `completedAt` as `Date.now()` (a number) or an ISO string, not a `Date`,
and bytes as [transferFile](../functions/transferFile.md) rather than a `Data` leaf. Background:
`docs/design-platform-data-package.md` §"Everything inbound is a property list".
