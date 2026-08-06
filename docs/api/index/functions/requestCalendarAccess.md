[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / requestCalendarAccess

# Function: requestCalendarAccess()

> **requestCalendarAccess**(`entity`): `Promise`\<[`CalendarAccessResult`](../type-aliases/CalendarAccessResult.md)\>

Defined in: [js/src/calendar.ts:113](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/calendar.ts#L113)

Shows the EventKit permission sheet for one entity and reports the resulting
status. Once the user has answered, calling it again returns the standing
status **without** re-prompting, so this doubles as the status read.

Ask for `"events"` and `"reminders"` separately — they are two independent
OS permissions, and an app that only shows a schedule should never ask for
reminders.

## Parameters

### entity

`"events"` \| `"reminders"`

## Returns

`Promise`\<[`CalendarAccessResult`](../type-aliases/CalendarAccessResult.md)\>
