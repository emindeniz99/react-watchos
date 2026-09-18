[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / UpdateManifest

# Interface: UpdateManifest

Defined in: [js/src/update.ts:220](https://github.com/emindeniz99/react-watchos/blob/main/js/src/update.ts#L220)

The update manifest served by your update endpoint (dist/manifest.json).

## Properties

### bundle

> **bundle**: `string`

Defined in: [js/src/update.ts:230](https://github.com/emindeniz99/react-watchos/blob/main/js/src/update.ts#L230)

Bundle URL — absolute (https), or relative to the manifest URL.

***

### expiresAt?

> `optional` **expiresAt?**: `number`

Defined in: [js/src/update.ts:240](https://github.com/emindeniz99/react-watchos/blob/main/js/src/update.ts#L240)

Epoch seconds after which the signature stops verifying on the watch
 (bound into the signed bytes — the revocation lever). 0/omitted = never
 expires. Set at signing time (`signManifest`/OTA_SIGNING_EXPIRES_DAYS).

***

### keyId?

> `optional` **keyId?**: `string`

Defined in: [js/src/update.ts:236](https://github.com/emindeniz99/react-watchos/blob/main/js/src/update.ts#L236)

Opaque id of the signing key (CX-007). Selects the watch's trusted public
 key and is bound into the signed bytes; an unknown id fails closed.

***

### minBridgeProtocol?

> `optional` **minBridgeProtocol?**: `number`

Defined in: [js/src/update.ts:254](https://github.com/emindeniz99/react-watchos/blob/main/js/src/update.ts#L254)

Minimum host bridge-protocol version the bundle needs (ARCH-01).

***

### releaseId?

> `optional` **releaseId?**: `string`

Defined in: [js/src/update.ts:228](https://github.com/emindeniz99/react-watchos/blob/main/js/src/update.ts#L228)

Content id of the bundle (CX-025): the FRESHNESS signal, distinct from
 `version`. Lets a non-breaking fix (same version, new content) be detected
 as an update. Stamped by the build; matches the host's `__bundleReleaseId`
 for the same bytes.

***

### requiredFeatures?

> `optional` **requiredFeatures?**: `string`[]

Defined in: [js/src/update.ts:252](https://github.com/emindeniz99/react-watchos/blob/main/js/src/update.ts#L252)

Capability features the bundle requires (ARCH-01), e.g. ["network",
"bluetooth"]. The watch refuses to apply a bundle whose features its binary
doesn't provide — OTA can't add native capability, so the user must update
the app. Omitted = no capability requirement declared.

***

### sequence?

> `optional` **sequence?**: `number`

Defined in: [js/src/update.ts:245](https://github.com/emindeniz99/react-watchos/blob/main/js/src/update.ts#L245)

Publish sequence (bound into the signed bytes): orders releases at the
 same `version`. The watch keeps the highest it has accepted and refuses
 a lower one, so a re-served earlier build is not installed. Set at
 signing time (`signManifest`; default = signing time in epoch seconds).

***

### signature?

> `optional` **signature?**: `string`

Defined in: [js/src/update.ts:233](https://github.com/emindeniz99/react-watchos/blob/main/js/src/update.ts#L233)

base64 Ed25519 signature over
 "v3:<keyId>:<version>:<sequence>:<expiresAt>:<bundle-js>".

***

### version

> **version**: `number`

Defined in: [js/src/update.ts:223](https://github.com/emindeniz99/react-watchos/blob/main/js/src/update.ts#L223)

Monotonic compatibility version — the anti-rollback GATE (bumped only on a
 breaking change), not the freshness signal.
