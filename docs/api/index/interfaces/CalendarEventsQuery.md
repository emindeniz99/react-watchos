[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / CalendarEventsQuery

# Interface: CalendarEventsQuery

Defined in: [js/src/calendar.ts:84](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/calendar.ts#L84)

Request for [getCalendarEvents](../functions/getCalendarEvents.md).

## Properties

### endMs

> **endMs**: `number`

Defined in: [js/src/calendar.ts:90](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/calendar.ts#L90)

Absolute ms since epoch. Must be after `startMs` — an inverted window
 rejects `INVALID_REQUEST` rather than resolving an empty list a caller
 cannot tell from "nothing scheduled".

***

### limit?

> `optional` **limit?**: `number`

Defined in: [js/src/calendar.ts:92](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/calendar.ts#L92)

Cap on events returned. Hard ceiling 250.

***

### startMs

> **startMs**: `number`

Defined in: [js/src/calendar.ts:86](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/calendar.ts#L86)

Absolute ms since epoch.
