[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / transferUserInfo

# Function: transferUserInfo()

> **transferUserInfo**(`userInfo`): `Promise`\<`void`\>

Defined in: [js/src/connectivity.ts:103](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L103)

Queues a background transfer to the paired iPhone: every queued item is
delivered IN ORDER when the counterpart wakes, and the queue survives app
suspension. Resolves once queued (per-item delivery isn't observable).
The right channel for must-not-drop event streams — logged workouts,
completed purchases.

## Parameters

### userInfo

`Record`\<`string`, `unknown`\>

## Returns

`Promise`\<`void`\>
