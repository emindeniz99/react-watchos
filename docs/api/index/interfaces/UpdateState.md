[**react-watchos API v0.1.0**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / UpdateState

# Interface: UpdateState

Defined in: [js/src/update.ts:50](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/update.ts#L50)

What the watch is actually running — the OTA observability surface
 (fleet telemetry): report these fields to your backend to know each
 device's bundle spread and to implement the staleness/freeze monitoring
 docs/ota-signing.md recommends.

## Properties

### expiresAt?

> `optional` **expiresAt?**: `number`

Defined in: [js/src/update.ts:59](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/update.ts#L59)

The running record's signed expiry (epoch seconds; absent/0 = never).

***

### highWater

> **highWater**: `number`

Defined in: [js/src/update.ts:61](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/update.ts#L61)

The device's anti-rollback high-water mark.

***

### keyId?

> `optional` **keyId?**: `string`

Defined in: [js/src/update.ts:57](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/update.ts#L57)

The signing key that shipped the running OTA bundle.

***

### releaseId?

> `optional` **releaseId?**: `string`

Defined in: [js/src/update.ts:65](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/update.ts#L65)

Content id of the RUNNING bundle (same value as the manifest
 `releaseId` for identical bytes) — merged in from the host-injected
 `__bundleReleaseId`, so it's present even for the shipped bundle.

***

### source

> **source**: `"ota"` \| `"shipped"`

Defined in: [js/src/update.ts:52](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/update.ts#L52)

Which bundle booted this launch.

***

### version?

> `optional` **version?**: `number`

Defined in: [js/src/update.ts:55](https://github.com/emindeniz99/playground/blob/964f57f947d24bfbd939270d94dd735bc5393430/projects/react-native-watchos/js/src/update.ts#L55)

The running OTA record's compatibility version (absent when shipped or
 running an unsigned dev bundle).
