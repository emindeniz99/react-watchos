[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / getReminders

# Function: getReminders()

> **getReminders**(`request?`): `Promise`\<[`Reminder`](../interfaces/Reminder.md)[]\>

Defined in: [js/src/calendar.ts:145](https://github.com/emindeniz99/react-watchos/blob/main/js/src/calendar.ts#L145)

Incomplete reminders due before `dueBeforeMs` (default: 30 days out),
earliest first. Same empty-vs-denied split as [getCalendarEvents](getCalendarEvents.md).

## Parameters

### request?

[`RemindersQuery`](../interfaces/RemindersQuery.md) = `{}`

## Returns

`Promise`\<[`Reminder`](../interfaces/Reminder.md)[]\>
