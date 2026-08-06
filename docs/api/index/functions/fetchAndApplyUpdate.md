[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / fetchAndApplyUpdate

# Function: fetchAndApplyUpdate()

> **fetchAndApplyUpdate**(`manifestUrl`): `Promise`\<`number` \| `null`\>

Defined in: [js/src/update.ts:472](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/update.ts#L472)

Fetches the manifest and, if it's a fresher release than this bundle
(`releaseId`/version, CX-025), downloads the bundle and stages it
(applyUpdate). Returns the staged version, or null if already up to date —
or if the bundle needs a capability this binary lacks
(ARCH-01), in which case it's NOT downloaded (the app must be updated; use
checkForUpdate to surface that). The staged update takes effect next launch.

## Parameters

### manifestUrl

`string`

## Returns

`Promise`\<`number` \| `null`\>
