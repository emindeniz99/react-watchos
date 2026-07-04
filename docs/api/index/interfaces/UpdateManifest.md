[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / UpdateManifest

# Interface: UpdateManifest

Defined in: [js/src/update.ts:132](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/update.ts#L132)

The update manifest served by your update endpoint (dist/manifest.json).

## Properties

### bundle

> **bundle**: `string`

Defined in: [js/src/update.ts:142](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/update.ts#L142)

Bundle URL — absolute (https), or relative to the manifest URL.

***

### expiresAt?

> `optional` **expiresAt?**: `number`

Defined in: [js/src/update.ts:152](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/update.ts#L152)

Epoch seconds after which the signature stops verifying on the watch
 (bound into the signed bytes — the revocation lever). 0/omitted = never
 expires. Set at signing time (`signManifest`/OTA_SIGNING_EXPIRES_DAYS).

***

### keyId?

> `optional` **keyId?**: `string`

Defined in: [js/src/update.ts:148](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/update.ts#L148)

Opaque id of the signing key (CX-007). Selects the watch's trusted public
 key and is bound into the signed bytes; an unknown id fails closed.

***

### minBridgeProtocol?

> `optional` **minBridgeProtocol?**: `number`

Defined in: [js/src/update.ts:161](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/update.ts#L161)

Minimum host bridge-protocol version the bundle needs (ARCH-01).

***

### releaseId?

> `optional` **releaseId?**: `string`

Defined in: [js/src/update.ts:140](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/update.ts#L140)

Content id of the bundle (CX-025): the FRESHNESS signal, distinct from
 `version`. Lets a non-breaking fix (same version, new content) be detected
 as an update. Stamped by the build; matches the host's `__bundleReleaseId`
 for the same bytes.

***

### requiredFeatures?

> `optional` **requiredFeatures?**: `string`[]

Defined in: [js/src/update.ts:159](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/update.ts#L159)

Capability features the bundle requires (ARCH-01), e.g. ["network",
"bluetooth"]. The watch refuses to apply a bundle whose features its binary
doesn't provide — OTA can't add native capability, so the user must update
the app. Omitted = no capability requirement declared.

***

### signature?

> `optional` **signature?**: `string`

Defined in: [js/src/update.ts:145](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/update.ts#L145)

base64 Ed25519 signature over
 "v2:<keyId>:<version>:<expiresAt>:<bundle-js>".

***

### version

> **version**: `number`

Defined in: [js/src/update.ts:135](https://github.com/emindeniz99/playground/blob/main/projects/react-native-watchos/js/src/update.ts#L135)

Monotonic compatibility version — the anti-rollback GATE (bumped only on a
 breaking change), not the freshness signal.
