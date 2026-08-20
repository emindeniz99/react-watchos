[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / querySleepSamples

# Function: querySleepSamples()

> **querySleepSamples**(`request`): `Promise`\<[`SleepSample`](../interfaces/SleepSample.md)[]\>

Defined in: [js/src/health.ts:227](https://github.com/emindeniz99/react-watchos/blob/main/js/src/health.ts#L227)

Sleep intervals in `[startMs, endMs)`, newest first. Needs
`requestHealthAuthorization({ read: [], sleep: true })` first — sleep is a
category type and can't ride the `read` list.

## Parameters

### request

[`SleepSamplesQuery`](../interfaces/SleepSamplesQuery.md)

## Returns

`Promise`\<[`SleepSample`](../interfaces/SleepSample.md)[]\>
