[**react-watchos API**](../../README.md)

***

[react-watchos API](../../README.md) / [index](../README.md) / UpdateState

# Interface: UpdateState

Defined in: [js/src/update.ts:59](https://github.com/emindeniz99/react-watchos/blob/main/js/src/update.ts#L59)

What the watch is actually running — the OTA observability surface
 (fleet telemetry): report these fields to your backend to know each
 device's bundle spread and to implement the staleness/freeze monitoring
 docs/ota-signing.md recommends.

## Properties

### bootAttempts

> **bootAttempts**: `number`

Defined in: [js/src/update.ts:96](https://github.com/emindeniz99/react-watchos/blob/main/js/src/update.ts#L96)

Launches of the running OTA bundle that have not yet reached a healthy
 confirmation. The counter is incremented BEFORE the bundle runs, so a
 launch reports 1…`maxOTABootAttempts` (3); the rollback happens at the
 START of the next launch, once the stored value has reached 3. Resets to
 0 when the bundle is blessed. `3` on an `"explicit"` device is therefore
 the bundle whose next launch rolls back — the signal worth alerting on.
 Not scoped to the running bundle: a `source: "shipped"` boot can still
 report a non-zero count left by a dropped OTA until a blessing clears it.

***

### expiresAt?

> `optional` **expiresAt?**: `number`

Defined in: [js/src/update.ts:68](https://github.com/emindeniz99/react-watchos/blob/main/js/src/update.ts#L68)

The running record's signed expiry (epoch seconds; absent/0 = never).

***

### healthSignal

> **healthSignal**: `"commit"` \| `"explicit"`

Defined in: [js/src/update.ts:87](https://github.com/emindeniz99/react-watchos/blob/main/js/src/update.ts#L87)

Which ARCH-04 health policy the NATIVE BINARY is configured for.
 `"commit"` = the first rendered tree blesses the bundle; `"explicit"` =
 only `markUpdateHealthy()` does. A bundle can't infer this — the policy
 is a native-side trust anchor — so report it to know which half of your
 fleet actually enforces the confirmation.

***

### highWater

> **highWater**: `number`

Defined in: [js/src/update.ts:73](https://github.com/emindeniz99/react-watchos/blob/main/js/src/update.ts#L73)

The device's anti-rollback high-water mark.

***

### keyId?

> `optional` **keyId?**: `string`

Defined in: [js/src/update.ts:66](https://github.com/emindeniz99/react-watchos/blob/main/js/src/update.ts#L66)

The signing key that shipped the running OTA bundle.

***

### releaseId?

> `optional` **releaseId?**: `string`

Defined in: [js/src/update.ts:81](https://github.com/emindeniz99/react-watchos/blob/main/js/src/update.ts#L81)

Content id of the RUNNING bundle (same value as the manifest
 `releaseId` for identical bytes) — merged in from the host-injected
 `__bundleReleaseId`, so it's present even for the shipped bundle.

***

### sequence?

> `optional` **sequence?**: `number`

Defined in: [js/src/update.ts:71](https://github.com/emindeniz99/react-watchos/blob/main/js/src/update.ts#L71)

The running OTA record's signed publish sequence (absent when shipped
 or running an unsigned dev bundle).

***

### sequenceHighWater

> **sequenceHighWater**: `number`

Defined in: [js/src/update.ts:77](https://github.com/emindeniz99/react-watchos/blob/main/js/src/update.ts#L77)

The highest publish `sequence` this device has ACCEPTED AT SAVE (not
 necessarily booted); a manifest below it is refused as a replay. 0 on a
 fresh install.

***

### source

> **source**: `"ota"` \| `"shipped"`

Defined in: [js/src/update.ts:61](https://github.com/emindeniz99/react-watchos/blob/main/js/src/update.ts#L61)

Which bundle booted this launch.

***

### version?

> `optional` **version?**: `number`

Defined in: [js/src/update.ts:64](https://github.com/emindeniz99/react-watchos/blob/main/js/src/update.ts#L64)

The running OTA record's compatibility version (absent when shipped or
 running an unsigned dev bundle).
