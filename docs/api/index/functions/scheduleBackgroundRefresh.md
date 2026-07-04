[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / scheduleBackgroundRefresh

# Function: scheduleBackgroundRefresh()

> **scheduleBackgroundRefresh**(`afterMs`, `userInfo?`): `Promise`\<`void`\>

Defined in: [js/src/background.ts:24](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/background.ts#L24)

Asks watchOS to wake the app ~`afterMs` from now. `userInfo` is echoed back
on the fire event so you can tag why you scheduled it. Resolves once the
request is registered (not when it fires).

## Parameters

### afterMs

`number`

### userInfo?

`Record`\<`string`, `unknown`\>

## Returns

`Promise`\<`void`\>
