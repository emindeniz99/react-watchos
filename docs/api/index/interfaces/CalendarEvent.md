[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / CalendarEvent

# Interface: CalendarEvent

Defined in: [js/src/calendar.ts:54](https://github.com/emindeniz99/react-watchos/blob/main/js/src/calendar.ts#L54)

One event occurrence in the requested window.

## Properties

### allDay

> **allDay**: `boolean`

Defined in: [js/src/calendar.ts:64](https://github.com/emindeniz99/react-watchos/blob/main/js/src/calendar.ts#L64)

***

### calendarTitle

> **calendarTitle**: `string`

Defined in: [js/src/calendar.ts:68](https://github.com/emindeniz99/react-watchos/blob/main/js/src/calendar.ts#L68)

The calendar the event belongs to, e.g. "Work".

***

### endMs

> **endMs**: `number`

Defined in: [js/src/calendar.ts:63](https://github.com/emindeniz99/react-watchos/blob/main/js/src/calendar.ts#L63)

***

### id

> **id**: `string`

Defined in: [js/src/calendar.ts:60](https://github.com/emindeniz99/react-watchos/blob/main/js/src/calendar.ts#L60)

`EKEvent.eventIdentifier` — **shared by every occurrence of a recurring
series**, so it is not unique in a multi-day window. Use `id + startMs` as
a React key.

***

### location?

> `optional` **location?**: `string`

Defined in: [js/src/calendar.ts:66](https://github.com/emindeniz99/react-watchos/blob/main/js/src/calendar.ts#L66)

Absent when the event has no location.

***

### startMs

> **startMs**: `number`

Defined in: [js/src/calendar.ts:62](https://github.com/emindeniz99/react-watchos/blob/main/js/src/calendar.ts#L62)

***

### title

> **title**: `string`

Defined in: [js/src/calendar.ts:61](https://github.com/emindeniz99/react-watchos/blob/main/js/src/calendar.ts#L61)
