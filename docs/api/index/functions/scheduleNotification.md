[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / scheduleNotification

# Function: scheduleNotification()

> **scheduleNotification**(`request`): `Promise`\<[`ScheduleNotificationResult`](../interfaces/ScheduleNotificationResult.md)\>

Defined in: [js/src/notifications.ts:86](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/notifications.ts#L86)

Schedules a local notification and resolves whether the watch accepted it
(CX-022). Routed through the generic invoke channel (SD-1) so a native failure
(UNUserNotificationCenter.add error) is reported instead of vanishing. The
`id` is deterministic — generated here when omitted and always returned in the
result — so callers can cancel it later regardless of the outcome. Resolves
(never rejects): no notification host (tests/Node/widget) comes back as
`{ scheduled: false, code: "UNAVAILABLE" }`.

## Parameters

### request

[`NotificationRequest`](../interfaces/NotificationRequest.md)

## Returns

`Promise`\<[`ScheduleNotificationResult`](../interfaces/ScheduleNotificationResult.md)\>
