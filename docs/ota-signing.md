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

Prints two base64 values:

- **public key** → pass to the app: `ReactWatchRootView(ota: OTAConfig(publicKeyBase64: "…"))`.
- **signing (private) key** → store as a **CI secret** named `OTA_SIGNING_KEY`.
  **Never commit it.** It is the only thing that lets you ship a bundle the
  watch will run — treat it like a code-signing key. Rotating it means shipping
  a native release with the new public key.

With **no** public key configured the app is *fail-open*: it loads unsigned
bundles and logs a warning. Configure the key to enforce signatures + the
anti-rollback gate.

## 2. Build, then sign (in CI, at publish time)

```sh
npm run build                          # emits dist/bundle.js + dist/manifest.json (signature: null)
OTA_SIGNING_KEY="$OTA_SIGNING_KEY" npm run ota:sign   # fills manifest.json's signature
```

`ota:sign` signs the exact bytes the watch verifies —
`"v1:<version>:<dist/bundle.js>"` (matching Swift's `UpdatePlan.signedMessage`)
— and writes the base64 signature into `dist/manifest.json`. Signing is a
**separate step from `build`** on purpose: the private key never touches a dev
build.

Then upload `dist/manifest.json` and `dist/bundle.js` to your update endpoint
(serve over **HTTPS**). The app's `fetchAndApplyUpdate(manifestUrl)` /
`checkForUpdate(manifestUrl)` consume them; in the hard gate, the native
recovery path (`OTAConfig.manifestURL`) does the same.

The manifest:

```json
{ "version": 1, "bundle": "bundle.js", "signature": "<base64>" }
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
