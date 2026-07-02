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
`"v1:<kid>:<version>:<dist/bundle.js>"` (matching Swift's
`UpdatePlan.signedMessage`) — and writes the base64 signature **and the `keyId`**
into `dist/manifest.json`. Signing is a **separate step from `build`** on
purpose: the private key never touches a dev build.

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

## Interop is tested

`OTASigningInteropTests` (Swift) verifies a Node-produced signature with
CryptoKit over `UpdatePlan.signedMessage`, so the signer and the verifier can't
silently drift apart.

## Threat-model note: the manifest itself is NOT signed (freeze exposure)

The signature covers `v1:<keyId>:<version>:<bundle-js>` — the **bundle
content and its compatibility version**, which is what stops in-sandbox RCE
and version swaps. The **manifest JSON is not signed**, so an on-path
attacker who can answer the manifest URL cannot inject code, but CAN:

- serve a stale manifest forever (a **freeze/suppression attack** — clients
  report "up to date" while a real fix exists), or
- flip `requiredFeatures`/`minBridgeProtocol` to make the gate stricter and
  suppress an applicable update the same way.

Neither path executes code (a tampered bundle URL still fails signature
verification, and NF-32 makes a malformed manifest throw loudly instead of
reading as "up to date"). Mitigations, in order of value: serve the manifest
over HTTPS from an origin you control (the baseline assumption), keep
manifest cache times short, and monitor fleet version/releaseId telemetry for
staleness. Signing the manifest body is the structural fix if the freeze
risk ever matters for your deployment — pre-release, extending
`signedMessage` to cover it is a schema change away.
