[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / getUpdateState

# Function: getUpdateState()

> **getUpdateState**(): `Promise`\<[`UpdateState`](../interfaces/UpdateState.md)\>

Defined in: [js/src/update.ts:92](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/update.ts#L92)

Reports which bundle this launch actually booted + the device's OTA state
(review §6.11b — observability). Never rejects: with no invoke-capable host
(tests/Node) it resolves a bare shipped/zeroed state so telemetry code can
run unconditionally.

## Returns

`Promise`\<[`UpdateState`](../interfaces/UpdateState.md)\>
