[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / ActivitySummariesQuery

# Interface: ActivitySummariesQuery

Defined in: [js/src/health.ts:169](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L169)

Request for [queryActivitySummaries](../functions/queryActivitySummaries.md). Days, not milliseconds — see the
 function's doc for why.

## Properties

### endDate

> **endDate**: `string`

Defined in: [js/src/health.ts:177](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L177)

Last day to report, **inclusive** — `startDate === endDate` asks for one
 day, which is the ask behind a rings complication (the *app* makes it and
 publishes the answer; see [queryActivitySummaries](../functions/queryActivitySummaries.md)). At most 1000
 days per call; a wider range rejects `INVALID_REQUEST` rather than coming
 back quietly truncated.

***

### startDate

> **startDate**: `string`

Defined in: [js/src/health.ts:171](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L171)

First day to report, `"YYYY-MM-DD"` (zero-padded, ten characters).
