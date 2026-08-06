[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / applyUpdate

# Function: applyUpdate()

> **applyUpdate**(`js`, `version?`, `signature?`, `keyId?`, `requiredFeatures?`, `minBridgeProtocol?`, `expiresAt?`): `Promise`\<`SaveUpdateResult`\>

Defined in: [js/src/update.ts:159](https://github.com/emindeniz99/react-watchos/blob/main/js/src/update.ts#L159)

Stages an OTA bundle and resolves whether the watch accepted it (CX-005).
Resolves (never rejects) with `{ accepted }` — a refusal from the native side
(bad signature, capability gap, downgrade, write failure) comes back as
`{ accepted: false, code, message }`, and no invoke-capable host (tests/Node)
as `{ accepted: false }` too, so the UI can always tell the user why. Routed
through the generic invoke channel (SD-1); the native `saveUpdate` handler
always *resolves* its invoke with a SaveUpdateResult.

## Parameters

### js

`string`

### version?

`number`

### signature?

`string`

### keyId?

`string`

### requiredFeatures?

`string`[]

### minBridgeProtocol?

`number`

### expiresAt?

`number`

## Returns

`Promise`\<`SaveUpdateResult`\>
