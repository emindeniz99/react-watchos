[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / RemindersQuery

# Interface: RemindersQuery

Defined in: [js/src/calendar.ts:96](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/calendar.ts#L96)

Request for [getReminders](../functions/getReminders.md).

## Properties

### dueBeforeMs?

> `optional` **dueBeforeMs?**: `number`

Defined in: [js/src/calendar.ts:99](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/calendar.ts#L99)

Only reminders due before this instant. Defaults to 30 days out —
 "everything incomplete, ever" is an unbounded query.

***

### limit?

> `optional` **limit?**: `number`

Defined in: [js/src/calendar.ts:101](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/calendar.ts#L101)

Cap on reminders returned. Hard ceiling 250.
