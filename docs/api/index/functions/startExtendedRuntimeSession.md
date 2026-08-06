[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / startExtendedRuntimeSession

# Function: startExtendedRuntimeSession()

> **startExtendedRuntimeSession**(): `Promise`\<`void`\>

Defined in: [js/src/extendedRuntime.ts:30](https://github.com/emindeniz99/react-watchos/blob/main/js/src/extendedRuntime.ts#L30)

Starts a session. Resolves when the session is actually RUNNING — the invoke
is parked on `WKExtendedRuntimeSession`'s delegate, not settled when the
request is submitted — and rejects `UNAVAILABLE` when the system declines:
a session is already active, or it invalidates immediately (the usual cause
being a missing runtime-session reason in the app's Info.plist, whose reason
string comes back in the error message).

## Returns

`Promise`\<`void`\>
