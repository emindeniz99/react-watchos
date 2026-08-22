[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / checkForUpdate

# Function: checkForUpdate()

> **checkForUpdate**(`manifestUrl`): `Promise`\<\{ `appUpdateRequired?`: `boolean`; `current`: `number`; `latest`: `number`; `missingCapabilities?`: `string`[]; `updateAvailable`: `boolean`; \}\>

Defined in: [js/src/update.ts:524](https://github.com/emindeniz99/react-watchos/blob/main/js/src/update.ts#L524)

Fetches the update manifest and reports whether a newer release is available.
Freshness keys on the bundle's `releaseId` (CX-025), so a non-breaking fix
with the same compatibility `version` is detected too; a version downgrade is
never reported. Use it to drive an "update available" prompt. Always HTTPS.

If the manifest declares `requiredFeatures`/`minBridgeProtocol` that this
binary doesn't provide (ARCH-01), the update can't be applied over the air —
the result reports `appUpdateRequired` + `missingCapabilities` (and
`updateAvailable` is false) so the UI can prompt an App Store update instead.

## Parameters

### manifestUrl

`string`

## Returns

`Promise`\<\{ `appUpdateRequired?`: `boolean`; `current`: `number`; `latest`: `number`; `missingCapabilities?`: `string`[]; `updateAvailable`: `boolean`; \}\>
