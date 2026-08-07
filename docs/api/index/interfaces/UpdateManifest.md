[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / UpdateManifest

# Interface: UpdateManifest

Defined in: [js/src/update.ts:207](https://github.com/emindeniz99/react-watchos/blob/main/js/src/update.ts#L207)

The update manifest served by your update endpoint (dist/manifest.json).

## Properties

### bundle

> **bundle**: `string`

Defined in: [js/src/update.ts:217](https://github.com/emindeniz99/react-watchos/blob/main/js/src/update.ts#L217)

Bundle URL — absolute (https), or relative to the manifest URL.

***

### expiresAt?

> `optional` **expiresAt?**: `number`

Defined in: [js/src/update.ts:227](https://github.com/emindeniz99/react-watchos/blob/main/js/src/update.ts#L227)

Epoch seconds after which the signature stops verifying on the watch
 (bound into the signed bytes — the revocation lever). 0/omitted = never
 expires. Set at signing time (`signManifest`/OTA_SIGNING_EXPIRES_DAYS).

***

### keyId?

> `optional` **keyId?**: `string`

Defined in: [js/src/update.ts:223](https://github.com/emindeniz99/react-watchos/blob/main/js/src/update.ts#L223)

Opaque id of the signing key (CX-007). Selects the watch's trusted public
 key and is bound into the signed bytes; an unknown id fails closed.

***

### minBridgeProtocol?

> `optional` **minBridgeProtocol?**: `number`

Defined in: [js/src/update.ts:236](https://github.com/emindeniz99/react-watchos/blob/main/js/src/update.ts#L236)

Minimum host bridge-protocol version the bundle needs (ARCH-01).

***

### releaseId?

> `optional` **releaseId?**: `string`

Defined in: [js/src/update.ts:215](https://github.com/emindeniz99/react-watchos/blob/main/js/src/update.ts#L215)

Content id of the bundle (CX-025): the FRESHNESS signal, distinct from
 `version`. Lets a non-breaking fix (same version, new content) be detected
 as an update. Stamped by the build; matches the host's `__bundleReleaseId`
 for the same bytes.

***

### requiredFeatures?

> `optional` **requiredFeatures?**: `string`[]

Defined in: [js/src/update.ts:234](https://github.com/emindeniz99/react-watchos/blob/main/js/src/update.ts#L234)

Capability features the bundle requires (ARCH-01), e.g. ["network",
"bluetooth"]. The watch refuses to apply a bundle whose features its binary
doesn't provide — OTA can't add native capability, so the user must update
the app. Omitted = no capability requirement declared.

***

### signature?

> `optional` **signature?**: `string`

Defined in: [js/src/update.ts:220](https://github.com/emindeniz99/react-watchos/blob/main/js/src/update.ts#L220)

base64 Ed25519 signature over
 "v2:<keyId>:<version>:<expiresAt>:<bundle-js>".

***

### version

> **version**: `number`

Defined in: [js/src/update.ts:210](https://github.com/emindeniz99/react-watchos/blob/main/js/src/update.ts#L210)

Monotonic compatibility version — the anti-rollback GATE (bumped only on a
 breaking change), not the freshness signal.
