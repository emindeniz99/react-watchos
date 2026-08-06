[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / ScheduleNotificationResult

# Interface: ScheduleNotificationResult

Defined in: [js/src/notifications.ts:69](https://github.com/emindeniz99/react-watchos/blob/main/js/src/notifications.ts#L69)

The outcome of scheduling a notification (CX-022). `id` is the deterministic
 id (pass it to cancelNotification); `scheduled` is false when the watch
 refused it (e.g. the 64-pending limit, a bad trigger) or there's no
 notification host, with a machine `code` + message for the reason.

## Properties

### code?

> `optional` **code?**: `string`

Defined in: [js/src/notifications.ts:73](https://github.com/emindeniz99/react-watchos/blob/main/js/src/notifications.ts#L73)

Set when scheduled is false.

***

### id

> **id**: `string`

Defined in: [js/src/notifications.ts:70](https://github.com/emindeniz99/react-watchos/blob/main/js/src/notifications.ts#L70)

***

### message?

> `optional` **message?**: `string`

Defined in: [js/src/notifications.ts:74](https://github.com/emindeniz99/react-watchos/blob/main/js/src/notifications.ts#L74)

***

### scheduled

> **scheduled**: `boolean`

Defined in: [js/src/notifications.ts:71](https://github.com/emindeniz99/react-watchos/blob/main/js/src/notifications.ts#L71)
