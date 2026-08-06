[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / UpdateManifest

# Interface: UpdateManifest

Defined in: [js/src/update.ts:196](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/update.ts#L196)

The update manifest served by your update endpoint (dist/manifest.json).

## Properties

### bundle

> **bundle**: `string`

Defined in: [js/src/update.ts:206](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/update.ts#L206)

Bundle URL — absolute (https), or relative to the manifest URL.

***

### expiresAt?

> `optional` **expiresAt?**: `number`

Defined in: [js/src/update.ts:216](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/update.ts#L216)

Epoch seconds after which the signature stops verifying on the watch
 (bound into the signed bytes — the revocation lever). 0/omitted = never
 expires. Set at signing time (`signManifest`/OTA_SIGNING_EXPIRES_DAYS).

***

### keyId?

> `optional` **keyId?**: `string`

Defined in: [js/src/update.ts:212](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/update.ts#L212)

Opaque id of the signing key (CX-007). Selects the watch's trusted public
 key and is bound into the signed bytes; an unknown id fails closed.

***

### minBridgeProtocol?

> `optional` **minBridgeProtocol?**: `number`

Defined in: [js/src/update.ts:225](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/update.ts#L225)

Minimum host bridge-protocol version the bundle needs (ARCH-01).

***

### releaseId?

> `optional` **releaseId?**: `string`

Defined in: [js/src/update.ts:204](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/update.ts#L204)

Content id of the bundle (CX-025): the FRESHNESS signal, distinct from
 `version`. Lets a non-breaking fix (same version, new content) be detected
 as an update. Stamped by the build; matches the host's `__bundleReleaseId`
 for the same bytes.

***

### requiredFeatures?

> `optional` **requiredFeatures?**: `string`[]

Defined in: [js/src/update.ts:223](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/update.ts#L223)

Capability features the bundle requires (ARCH-01), e.g. ["network",
"bluetooth"]. The watch refuses to apply a bundle whose features its binary
doesn't provide — OTA can't add native capability, so the user must update
the app. Omitted = no capability requirement declared.

***

### signature?

> `optional` **signature?**: `string`

Defined in: [js/src/update.ts:209](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/update.ts#L209)

base64 Ed25519 signature over
 "v2:<keyId>:<version>:<expiresAt>:<bundle-js>".

***

### version

> **version**: `number`

Defined in: [js/src/update.ts:199](https://github.com/emindeniz99/react-watchos/blob/main/projects/react-native-watchos/js/src/update.ts#L199)

Monotonic compatibility version — the anti-rollback GATE (bumped only on a
 breaking change), not the freshness signal.
