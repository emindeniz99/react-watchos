[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / CalendarAccessResult

# Type Alias: CalendarAccessResult

> **CalendarAccessResult** = `"granted"` \| `"denied"` \| `"restricted"` \| `"notDetermined"` \| `"writeOnly"` \| `"unavailable"`

Defined in: [js/src/calendar.ts:45](https://github.com/emindeniz99/react-watchos/blob/main/js/src/calendar.ts#L45)

What [requestCalendarAccess](../functions/requestCalendarAccess.md) resolves with.

Only `"granted"` can read. `"writeOnly"` is a real watchOS 10 state — the
user allowed adding, not reading — and `"notDetermined"` means nobody has
asked yet, which is the only one worth prompting about again.
