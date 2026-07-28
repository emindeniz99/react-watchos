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

## App Store compliance (Guideline 3.3.1(B))

Shipping JavaScript over the air is **explicitly permitted** by Apple, and has
been for years — but the permission is conditional, and the conditions are what
this library's design is shaped around.

**Where the clause lives.** Before June 2022 it was **§3.3.2** of the Apple
Developer Program License Agreement; it then moved to **§3.3.1(B)**
("Executable Code"), where it is today, and the wording was revised again in
**October 2025**. Same permission each time, renumbered and re-worded — which is
itself the reason for the caveat at the end of this section.

**The permission is in the license agreement only — don't expect to find it in
the Guidelines.** The App Review Guidelines neither repeat §3.3.1(B) nor cite
it, and **Guideline 2.5.2** — the rule a rejection is actually written against —
is a standalone prohibition: "Apps should be self-contained in their bundles,
and may not read or write data outside the designated container area, nor may
they download, install, or execute code which introduces or changes features or
functionality of the app, including other apps." Its one carve-out is for
educational apps; there is none for interpreted code. So don't argue to a
reviewer that 2.5.2 points at §3.3.1(B); it doesn't. What reconciles the two is
the mapping below — an update that cannot exceed what the reviewed binary
already declares isn't the kind of change 2.5.2 is aimed at.

**The three conditions**, in the order they matter for a watch app:

1. **It must not transform the app's purpose.** Downloaded code may not change
   the app into something other than what was reviewed.
2. **No store-within-a-store.** It may not create a storefront for other code,
   or distribute someone else's code to the user.
3. **It must not compromise user security.** It may not circumvent signing, the
   sandbox, or the platform's other protections.

### How this design maps to each

| Condition | What the library does |
|---|---|
| Purpose unchanged | An OTA update carries **JavaScript only** — one `bundle.js` plus a small manifest. No native code, no dylibs, no downloaded bytecode. Entitlements, `Info.plist`, the target set, and every native capability stay in the code-signed binary, so a bundle can only re-arrange behavior the reviewed app already had. |
| Purpose unchanged (enforced, not promised) | **`CapabilityGate`** (ARCH-01) refuses any bundle whose required feature set isn't a subset of the binary's — the answer is "update the app from the App Store", not "download more". **`HostPolicy`** (ARCH-07) lets the consumer narrow that further; a feature the app didn't authorize is absent from `__host` and rejects with `POLICY_DENIED`. Turning a sensitive feature (health, BLE, network, notifications, AI) on is **always a native release**. |
| No store-within-a-store | One app, one bundle, one publisher: the update channel is a manifest URL **you** control, resolved against **your** trusted signer keys. There is no bundle marketplace, no third-party code distribution, and no purchase surface outside StoreKit (the `iap` capability is native). |
| Security not compromised | Every bundle is **Ed25519-signed** over `v2:<keyId>:<version>:<expiresAt>:<bundle-js>`, with the `keyId` bound **inside** the signed bytes and the trust anchor (`signerPublicKeys`) shipping in the code-signed binary; an unknown `keyId` fails closed, empty keys refuse saves entirely, records are **re-verified at every boot** (app and widget), and the anti-rollback high-water mark plus the optional signed expiry stop replays. The bundle runs inside the app's own sandbox in an interpreter — it cannot reach anything the binary doesn't hand it. |
| Security not compromised (availability side) | The **health gate**: `otaBootAttempts` rolls a bundle back to the last known-good after 3 un-blessed launches, and `OTAConfig.healthSignal = .explicit` makes the bundle prove itself with `markUpdateHealthy()` after your own checks. A bad update degrades to the reviewed, shipped bundle instead of stranding the user. |

**On the bytecode.** The `.qbc` blob is **compiled on the device**, by the
embedded engine, from the JavaScript you downloaded (`compileToBytecode` →
`ota-bundle.qbc`) — it never crosses the network, and when signer keys are
enforced the boot doesn't even use it: it runs the re-verified **source**
instead ([`OTABootSequencer.swift`](../js/swift/Sources/ReactWatchSupport/OTABootSequencer.swift)).
That is the same class of artifact as the Hermes bytecode every React Native app
runs, and strictly more conservative than CodePush / Expo Updates, which ship
that bytecode over the wire in the update itself — a long-accepted industry
precedent for this clause.

### The honest caveat

Guidelines are applied **at review time, by a reviewer**, and they change: this
one has been renumbered once and re-worded again in the last three years. Nothing
here is legal advice, and none of it is a guarantee of approval. What the design
gives you is the **argument** — a signed, capability-bounded, JS-only update
channel that provably cannot exceed what the reviewed binary already declares —
not the verdict. And the argument only covers the transport: if the update you
want to ship would change *what your app is for*, that is a native release no
matter what the channel technically allows.

Sources:
[Bitrise — what app stores allow with OTA updates](https://bitrise.io/blog/post/what-app-stores-allow-with-ota-updates-apple-and-google-policy-explained),
[Capgo — Capacitor OTA updates & App Store approval](https://capgo.app/blog/capacitor-ota-updates-app-store-approval-guide/),
[Codemagic — React Native OTA: what can be deployed](https://blog.codemagic.io/react-native-ota-what-can-be-deployed/).

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
