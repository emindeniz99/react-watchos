# CX-025 — separate OTA freshness from the rollback gate (design)

Today the integer `version` does double duty: the **anti-rollback gate**
(native refuses an older bundle) *and* the **freshness signal** (`checkForUpdate`
/ `fetchAndApplyUpdate` compare `manifest.version > BUNDLE_VERSION`). So a
**non-breaking fix** that keeps the same compatibility `version` is seen as "not
newer" and **can never ship over the air**. CX-025: keep `version` as the gate,
add a separate `releaseId` for freshness.

## Proven primitive (de-risked)

`releaseId` should be a content identifier, and the JS build + the Swift host can
compute the SAME one: `ContentHash` is **FNV-1a 64-bit** (`ContentHash.swift`),
which a tiny JS function matches exactly — verified:

| input | JS FNV-1a | Swift `ContentHash.of` |
|---|---|---|
| `hello` | `a430d84680aabd0b` | `a430d84680aabd0b` |
| `globalThis.__x=42;` | `48f85877cc5dfcc0` | `48f85877cc5dfcc0` |

So the cross-language hash is not the risk; the **integration** is.

## Semantic model (the part to get right)

- **Freshness** ("should I update?"): `manifest.releaseId !== currentReleaseId`
  — the server's published bundle differs from the one running. Independent of
  `version`, so a same-version fix is detected.
- **Gate** ("may I apply?"): unchanged — native `VersionPolicy` anti-rollback on
  `version` + the ARCH-01 capability gate. `fetchAndApplyUpdate` should still
  avoid downloading a bundle the binary can't run.

## The open integration choice (why this needs a focused pass)

A bundle can't embed its own content hash (injecting the hash changes the
bytes). Two ways to give the running bundle its `releaseId`, each with a cost:

- **A — native exposure.** Host computes `ContentHash.of(loadedSource)` and sets
  `globalThis.__bundleReleaseId` next to `__hostFeatures`; build writes the same
  hash to the manifest. Clean + content-based, but the host loads the shipped
  bundle from **`.qbc` bytecode** without reading the source string
  (`loadShipped`), so it must read `bundle.js` *just to hash it* — an extra read
  + a native change in the load flow, per-bundle (shipped vs OTA).
- **B — build-time id.** Build injects a `BUNDLE_RELEASE_ID` (define or a
  placeholder it replaces post-build) and writes the same value to the manifest;
  `update.ts` reads `process.env.BUNDLE_RELEASE_ID`. JS-only, no native change,
  but the placeholder-replace has to be consistent across the **two bundles**
  (app + widget, ARCH-03) and **dev/min** builds, and a non-content id (build #)
  re-shows "update available" on an identical rebuild.

**Recommendation:** Option **A** (content-based, single source of truth, mirrors
the existing `__hostFeatures` injection), accepting the extra `bundle.js` read on
the `.qbc` path. Wire: `build.mjs` → `manifest.releaseId = fnv1a(bundle)`; host →
`__bundleReleaseId`; `update.ts` → freshness on `releaseId`, gate on `version`;
update `update.ota.test` (currently version-based freshness). All verifiable here
(vitest + watchOS build); it's deferred only because the load-flow integration +
the freshness-semantics change deserve focused care, not a blind multi-file edit.

## Acceptance

- [ ] `build.mjs` stamps `manifest.releaseId` (FNV-1a of the app bundle).
- [ ] Host exposes `__bundleReleaseId` for the loaded bundle (shipped + OTA).
- [ ] `checkForUpdate`/`fetchAndApplyUpdate` use `releaseId` for freshness,
      `version` only for the gate; tests updated for same-version freshness.
