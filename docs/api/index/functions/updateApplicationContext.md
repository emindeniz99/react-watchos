[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / updateApplicationContext

# Function: updateApplicationContext()

> **updateApplicationContext**(`context`): `Promise`\<`void`\>

Defined in: [js/src/connectivity.ts:63](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L63)

Publishes latest-wins state to the paired iPhone in the BACKGROUND: the
phone receives the most recent context when it next wakes — no reachability
requirement, no queue (each call overwrites the previous context). Resolves
once handed to WCSession; rejects (`UNAVAILABLE`) when the session isn't
activated or (`INVALID_REQUEST`) on an oversized/non-plist payload. The
right channel for "current state" sync — settings, dashboard data.

## Parameters

### context

`Record`\<`string`, `unknown`\>

## Returns

`Promise`\<`void`\>
