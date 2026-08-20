[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / WorkoutHistoryQuery

# Interface: WorkoutHistoryQuery

Defined in: [js/src/health.ts:126](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L126)

Request for [queryWorkoutHistory](../functions/queryWorkoutHistory.md).

## Properties

### endMs

> **endMs**: `number`

Defined in: [js/src/health.ts:128](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L128)

***

### limit?

> `optional` **limit?**: `number`

Defined in: [js/src/health.ts:135](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L135)

Cap on workouts returned, applied to the *whole* window before you see
 it. Hard ceiling 1000 — and **omitting it caps at 1000 too**, silently
 dropping the oldest workouts of a wider window, so a "whole year" screen
 should page by window rather than ask for one. If you are filtering the
 result down to one activity ("my last five runs"), ask for more than
 five.

***

### startMs

> **startMs**: `number`

Defined in: [js/src/health.ts:127](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L127)
