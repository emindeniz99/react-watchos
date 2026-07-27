# Signing OTA bundles

An OTA bundle is arbitrary JavaScript that runs on the watch with the full host
surface, so an unverified one from a compromised origin is in-sandbox RCE
(CR-4). The watch verifies an **Ed25519 signature** over the bundle before it
will run it. This is how you produce that signature.

> Why Ed25519: deterministic, fast to verify on a low-power watch, tiny
> (32-byte key / 64-byte signature), no parameter footguns, and native to
> CryptoKit. See [code-review-2026-06-25.md](./code-review-2026-06-25.md) (CR-4
> / CR-17) for the comparison and threat model.

## 1. Generate a keypair (once)

```sh
npm run ota:keygen
```

Prints a **key id** (`kid`) plus two base64 values:

- **key id + public key** → add to the app's trusted-key map:
  `ReactWatchRootView(ota: OTAConfig(signerPublicKeys: ["<kid>": "<public>"]))`.
  The `signerPublicKeys` map is the trust anchor and ships **inside the
  code-signed app binary** — never source it from a channel the OTA path can
  touch.
- **signing (private) key** → store as a **CI secret** named `OTA_SIGNING_KEY`,
  and set its **`OTA_SIGNING_KEY_ID=<kid>`** alongside it. **Never commit the
  private key.** It is the only thing that lets you ship a bundle the watch will
  run — treat it like a code-signing key.

With an **empty** `signerPublicKeys` the app **refuses new OTA saves** (NF-29
secure default) — an example copied without keys cannot be hijacked by whoever
answers its manifest URL. For local development you can opt into the old
fail-open behavior explicitly with `OTAConfig(allowUnsignedUpdates: true)`
(unsigned bundles load with a loud warning); never ship a release with it set.
Configure at least one key to enforce signatures + the anti-rollback gate —
keys always win over the opt-in.

### Key rotation (CX-007)

The `kid` is bound **inside** the signed bytes, so it can't be swapped to steer
the watch to a different key, and an unknown `kid` **fails closed**. To rotate a
signing key without bricking any device, do it in two releases (overlap window):

1. **Rotate:** ship an app release whose `signerPublicKeys` trusts **both** the
   old and new `kid`, and switch CI's `OTA_SIGNING_KEY`/`OTA_SIGNING_KEY_ID` to
   the **new** key. Now old and new devices both verify.
2. **Revoke:** once enough of the fleet has that release, ship a release that
   **drops the old `kid`** from `signerPublicKeys`. Never reuse a retired `kid`.

Collapsing both steps into one strands any device that hasn't taken the release
that trusts the new key.

## 2. Build, then sign (in CI, at publish time)

```sh
npm run build                          # emits dist/bundle.js + dist/manifest.json (signature: null)
OTA_SIGNING_KEY="$OTA_SIGNING_KEY" \
OTA_SIGNING_KEY_ID="$OTA_SIGNING_KEY_ID" \
npm run ota:sign                       # fills manifest.json's signature + keyId
```

`ota:sign` signs the exact bytes the watch verifies —
`"v2:<kid>:<version>:<expiresAt>:<dist/bundle.js>"` (matching Swift's
`UpdatePlan.signedMessage`) — and writes the base64 signature **and the `keyId`**
into `dist/manifest.json`. Signing is a **separate step from `build`** on
purpose: the private key never touches a dev build.

Optional revocation lever: `OTA_SIGNING_EXPIRES_DAYS=<n>` binds an expiry
(epoch seconds) into the signed bytes. The watch refuses a lapsed bundle at
save AND at every boot re-verification (app and widget both), so a leaked or
superseded artifact can't be replayed forever — re-sign and re-publish to
extend. Unset = the signature never expires (`expiresAt: 0`).

Then upload `dist/manifest.json` and `dist/bundle.js` to your update endpoint
(serve over **HTTPS**). The app's `fetchAndApplyUpdate(manifestUrl)` /
`checkForUpdate(manifestUrl)` consume them; in the hard gate, the native
recovery path (`OTAConfig.manifestURL`) does the same.

The manifest:

```json
{ "version": 1, "bundle": "bundle.js", "signature": "<base64>", "keyId": "<kid>" }
```

## 3. Versioning (anti-rollback)

`version` is a **monotonic compatibility integer** in
[`scripts/config.mjs`](../js/scripts/config.mjs) (`bundleVersion`). **Bump it
only on a breaking change** (db schema / wire contract). When you do:

1. raise `bundleVersion` in `config.mjs`, and
2. raise `OTAConfig.shippedVersion` in the **native app** in lockstep with the
   bundle you ship in the binary.

The watch refuses any bundle **older** than the newest it has applied, so an old
bundle can never run against a newer-schema db. With the **hard** gate, stale JS
won't boot at all (it shows a native "update required" screen, recoverable via
`OTAConfig.manifestURL`).

## 4. Health signal — when a bundle is trusted enough to keep (ARCH-04)

A signature proves a bundle is *authentic*. It does not prove it *works*. So
the watch counts launches: `otaBootAttempts` increments before the OTA bundle
is evaluated and is cleared only when the bundle is declared **healthy**; at 3
un-cleared launches the crash-loop guard rolls back to the previous known-good
bundle, or to the one shipped in the app binary. Being declared healthy is also
what *promotes* a bundle to that known-good slot. `OTAConfig.healthSignal`
picks what counts as the declaration:

| Policy | Healthy when | Cost | Catches |
|---|---|---|---|
| `.firstCommit` (default) | the first tree renders | nothing — the bundle needs no code | a bundle that can't boot at all |
| `.explicit` | the bundle calls `markUpdateHealthy()` | you must ship the call | that **plus** a bundle that renders wrongly, or renders and then dies |

```swift
ReactWatchRootView(ota: OTAConfig(
    signerPublicKeys: ["k1": "<public>"],
    healthSignal: .explicit))
```

```ts
import { markUpdateHealthy } from "react-watchos";

// AFTER your own smoke checks — never at module top level, where it would
// confirm nothing more than "the file parsed".
useEffect(() => {
  if (dashboardLoaded && !loadError) markUpdateHealthy();
}, [dashboardLoaded, loadError]);
```

**There is no timer and no grace period — the counter is the whole
enforcement.** Under `.explicit`, a bundle that never calls
`markUpdateHealthy()` is rolled back after 3 launches. That is the contract,
not a bug: flip the flag and ship the calling bundle in the same release.

Calling `markUpdateHealthy()` on a `.firstCommit` binary is a harmless no-op
(the commit already blessed the bundle), so a bundle can ship the call
unconditionally. The policy lives in the **binary**, never in the bundle — for
the same reason `signerPublicKeys` does: a bundle that could relax its own
health bar would simply declare itself trustworthy. `getUpdateState()` reports
which policy the running binary enforces (`healthSignal`) and how many
un-blessed launches this device has accumulated (`bootAttempts`), so a fleet
dashboard can see "on explicit, one launch from rollback".

Two boots bless themselves under `.explicit`, because the bar is only
meaningful for an OTA bundle that has not yet proved itself:

- the **shipped** bundle — it lives inside this code-signed binary and has
  nothing to confirm. Without this, a counter left non-zero by a dropped OTA
  would survive into the next staged bundle and roll it back early.
- an OTA bundle that is **already the known-good snapshot** — so turning the
  flag on cannot retroactively condemn a bundle that predates the API. Without
  it, that bundle crash-loops, finds `knownGood == active`, and drops all the
  way to shipped: a silent downgrade caused purely by a config flip.

The **widget is exempt by design**: it renders the *known-good* record only and
never touches the boot counter
([`WidgetBundleChoice.swift`](../js/swift/Sources/ReactWatchSupport/WidgetBundleChoice.swift)),
so it inherits whatever the app decided and has nothing of its own to confirm.
`markUpdateHealthy` is `targets: ["watch"]` for that reason.

**Known limit under `.firstCommit`** (the default, accepted): because the first
commit clears the counter, a bundle that renders and *then* reliably dies —
QuickJS OOM on the second screen, a trap in a host callback, a runaway effect —
never accumulates attempts, so the rollback threshold is unreachable for it.
The obvious fix, "healthy after the first commit **and** T seconds", is wrong
on watchOS: glance-length sessions are the norm, so a user who opens the app
for three seconds three times would roll back a perfectly good bundle. Apps
that care about this case opt into `.explicit`, which closes it as a side
effect (the confirmation lands after the app's own checks). See
[prior-art.md](./prior-art.md#prior-art-beyond-the-renderer-confirming-a-boot-is-healthy-arch-04)
for the precedents this shape follows.

## Interop is tested

`OTASigningInteropTests` (Swift) verifies a Node-produced signature with
CryptoKit over `UpdatePlan.signedMessage`, so the signer and the verifier can't
silently drift apart.

## Threat-model note: the manifest itself is NOT signed (freeze exposure)

The signature covers `v2:<keyId>:<version>:<expiresAt>:<bundle-js>` — the
**bundle content, its compatibility version, and its expiry**, which is what
stops in-sandbox RCE, version swaps, and expiry-stripping. The **manifest JSON is not signed**, so an on-path
attacker who can answer the manifest URL cannot inject code, but CAN:

- serve a stale manifest forever (a **freeze/suppression attack** — clients
  report "up to date" while a real fix exists), or
- flip `requiredFeatures`/`minBridgeProtocol` to make the gate stricter and
  suppress an applicable update the same way.

Neither path executes code (a tampered bundle URL still fails signature
verification, and NF-32 makes a malformed manifest throw loudly instead of
reading as "up to date"). Stored records are also re-verified at every boot
when keys are enforced (NF-35), so even an actor who can write the App Group
container cannot swap in unsigned code. Mitigations, in order of value: serve the manifest
over HTTPS from an origin you control (the baseline assumption), keep
manifest cache times short, and monitor fleet version/releaseId telemetry for
staleness. Signing the manifest body is the structural fix if the freeze
risk ever matters for your deployment — pre-release, extending
`signedMessage` to cover it is a schema change away.
