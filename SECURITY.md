# Security

## Reporting a vulnerability

Please use [GitHub Security Advisories](https://github.com/emindeniz99/react-watchos/security/advisories/new)
(private) — the maintainer is notified immediately. For non-sensitive issues,
a regular issue is fine.

## Threat model — read this if a scanner flagged the package

Supply-chain scanners (e.g. Socket) correctly describe what this package IS:
a JavaScript execution host for watchOS that can download OTA update bundles,
evaluate them at runtime, and expose device capabilities (Keychain, fetch,
HealthKit, BLE…) to that JS environment. That is the product — the same
category of behavior as expo-updates or CodePush — so the honest question is
not "does it execute remote code" but "what stops an attacker from using
that". The answer, each part in the reviewed native binary and covered by
tests:

- **OTA bundles are Ed25519-signed, and unsigned updates are refused by
  default.** A consumer must opt in (`allowUnsignedUpdates: true`) to run
  unsigned bundles; the shipped default rejects them.
- **The keyId lives inside the signed bytes**, so a manifest cannot point a
  bundle at a different key than the one that signed it.
- **Anti-rollback + boot-time re-verification**: version regressions are
  refused, and the signature is re-checked at every boot, not only at
  download time.
- **Crash-loop rollback**: a bundle that fails to boot healthy is rolled back
  to the last known-good one automatically.
- **An OTA bundle can never gain native capability.** The `__host` surface is
  fixed in the compiled binary; a `HostPolicy` allowlist can narrow it
  further per app, and the policy is enforced again at OTA staging — a
  downloaded bundle requiring features the policy denies is refused before it
  runs.
- **Cleartext HTTP for OTA is LAN-only** (development); production update
  URLs must be HTTPS.
- **Keychain/BLE/Health access is feature-gated**: a bundle whose manifest
  does not declare the feature — or whose host policy denies it — cannot
  reach the corresponding APIs.

Design details and the exact verification chain:
[docs/ota-signing.md](./docs/ota-signing.md). What is verified at which level
(Linux-tested / watch-compiled / device): [docs/status.md](./docs/status.md).

## Supply-chain posture of this repo

- npm releases publish via **GitHub Actions OIDC trusted publishing** (no
  tokens anywhere; provenance attached automatically from 0.1.1 on; 0.1.0 was
  the manual bootstrap publish and predates the attestation).
- The repo runs **gitleaks + trufflehog** on every push/PR and weekly
  (`security.yml`), a local pre-push gitleaks hook, and a gitleaks scan of
  the exact npm tarball before every publish (`release.yml`).
- Dependencies install under a **7-day cooldown**
  (`minimumReleaseAge: 10080`, strict) and lifecycle scripts are sandboxed to
  an explicit `allowBuilds` allowlist.
- The vendored QuickJS engine is SHA-256-pinned (`CHECKSUMS.sha256`, verified
  on every `pnpm test`) and re-vendored only through a digest-checked script.
