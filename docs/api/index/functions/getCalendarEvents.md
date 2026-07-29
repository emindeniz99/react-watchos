[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / getCalendarEvents

# Function: getCalendarEvents()

> **getCalendarEvents**(`request`): `Promise`\<[`CalendarEvent`](../interfaces/CalendarEvent.md)[]\>

Defined in: [js/src/calendar.ts:135](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/calendar.ts#L135)

Events overlapping `[startMs, endMs)`, earliest first.

Resolves `[]` for a window with nothing in it. Rejects `PERMISSION_DENIED`
when this app cannot read the calendar — including the write-only and
never-asked cases, whose messages say which one it is — and
`INVALID_REQUEST` for a malformed window.

## Parameters

### request

[`CalendarEventsQuery`](../interfaces/CalendarEventsQuery.md)

## Returns

`Promise`\<[`CalendarEvent`](../interfaces/CalendarEvent.md)[]\>
