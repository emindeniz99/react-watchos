[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / sendToPhone

# Function: sendToPhone()

> **sendToPhone**(`message`): `Promise`\<`Record`\<`string`, `unknown`\>\>

Defined in: [js/src/connectivity.ts:68](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/connectivity.ts#L68)

Sends a message to the paired iPhone and resolves its reply (CX-022). Rejects
(with an InvokeError `code`) when the phone isn't reachable, the message
couldn't be delivered, or there's no connectivity-capable host — so a failed
send no longer vanishes. Uses WCSession.sendMessage under the hood, which
needs the counterpart reachable.

The REPLY is reduced to JSON like every other inbound plist — a `Date`/`Data`
leaf the phone legitimately replied with is dropped per-key and silently; see
the inbound reduction note at the top of this module.

## Parameters

### message

`Record`\<`string`, `unknown`\>

## Returns

`Promise`\<`Record`\<`string`, `unknown`\>\>
