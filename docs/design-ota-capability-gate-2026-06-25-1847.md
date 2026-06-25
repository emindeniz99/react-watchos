# Design note — OTA capability gate + state machine (SD-3 / SD-4)

The "short design note before code" flagged in the
[system-design review](./system-design-review-2026-06-25-1824-opus.md). Concrete
enough to implement; resolves the open forks with the owner (2026-06-25).

## Problem (restated)

There is **no DB**, so this is not data migration. The risk is **version skew
between an OTA JS bundle and the installed native binary**:

- **New JS on an old binary** — a bundle uses `fetchX` (or a new primitive) the
  installed Swift app doesn't have → crash / silently-missing UI.
- **Downgrade** — an older bundle running against a device that already advanced
  → must be refused.

Both must be gated, in both directions.

## Decisions (locked)

1. **`minHostApi` is auto-derived at build** — never hand-maintained.
2. **Gate covers `__host.*` methods AND UI primitives** — both carry a `since`;
   either being too new for the binary blocks the bundle.
3. **Runtime guard** is added as defense-in-depth (a bypassed gate throws a typed
   error, never a raw crash).
4. **Two-sided gate:** upper = capability, lower = anti-rollback.

> **Pre-release:** nothing has shipped or been built. Prefer clean breaking
> changes over compat layers — no scheme-version migrations, no "tolerates old
> payload" branches. Formats can just *be* what they should be.

## Version fields (and how they map to today's)

| Field | Lives in | Role | Today |
|-------|----------|------|-------|
| `wireVersion` | schema (`RNWire.v`) | tree wire-format compat (decode) | unchanged |
| **`releaseId`** | bundle + manifest; `shippedReleaseId` in native | **freshness + anti-rollback** (monotonic, bump **every** release) | was `bundleVersion` / `OTAConfig.shippedVersion` — semantics change to "every release" |
| **`hostApiVersion`** | native constant (new) | the binary's capability level | new |
| **`minHostApi`** | bundle + manifest (derived) | newest capability the bundle needs | new |

`otaHighWater` (App Group) keeps tracking the max accepted `releaseId`.
"Bump only on breaking change" is **dropped** — `releaseId` bumps every release
(freshness); compatibility is now `hostApiVersion`/`minHostApi`'s job. (This is
the concrete form of CX-007's "split.")

## Deriving `minHostApi` at build

- In `schema.mjs`, tag every capability with the `hostApiVersion` it shipped in:
  - each `hostMethods[]` entry gets `since: Int` (all existing = `1`);
  - add a **primitives** table (component type → `since`), existing = `1`. (This
    is the start of SD-6's component contract.)
- The build derives which capabilities a bundle actually uses from the **esbuild
  metafile** (already produced by [esbuild/preset.mjs](../js/esbuild/preset.mjs)):
  the metafile lists which named exports of `react-native-watchos` the app
  imports — host wrappers (`generateText`, `bleConnect`, …) *and* components
  (`Button`, `MapView`, …). Map each imported symbol → its `since`, take the max
  → `minHostApi`. Inject like `BUNDLE_VERSION` (a `define`).
- **Why metafile, not source scan:** robust against minification and indirection;
  no brittle regex over bundle text. Dynamic/indirect use is the gap → covered by
  the runtime guard.

## Gate logic

One pure function in `ReactWatchSupport` (Linux-tested), extending
`VersionPolicy`:

```
decide(bundle{releaseId,minHostApi}, native{hostApiVersion,highWater}) ->
  .blockUpdateApp   if bundle.minHostApi > native.hostApiVersion   // upper
  .blockDowngrade   if bundle.releaseId  < native.highWater         // lower
  .accept           otherwise
```

Checked at **three points**:
1. **JS, pre-download** (`checkForUpdate`/`fetchAndApplyUpdate`) — don't fetch a
   bundle we can't run; surface "update the app" vs "up to date".
2. **Native, at save** (`saveUpdate`) — defense; the manifest could lie.
3. **Native, at boot** (`load`) — catches a *native downgrade* below an
   already-staged bundle (app reinstalled older / restored).

`.blockUpdateApp` → native shows an "Update the app" screen (App Store; OTA can't
fix a too-old binary — distinct from the existing `manifestURL` recovery, which
only helps the *downgrade*/stale-JS case).

## Exposing `hostApiVersion` to JS

Inject at boot before the bundle (like the DEBUG inspector URL):
`globalThis.__hostApiVersion = <N>`. JS reads it in `checkForUpdate`. No bridge
round-trip needed; it's a constant for the process lifetime.

## Signing change

Bind both version fields into the signed bytes so neither can be relabelled to
sneak past the gate. **No scheme migration** (pre-release): just change the one
format in place to **`v1:<releaseId>:<minHostApi>:<js>`** — update
`UpdatePlan.signedMessage`, `ota-sign.mjs`, and `OTASigningInteropTests`
together. Don't add a `v2`/compat path for a format nobody has signed yet.

## Runtime guard (defense-in-depth)

The generated host wrappers (SD-6) call through a helper:
`callHost(name, sinceApi, …)` that throws a typed
`CapabilityError(name, sinceApi)` if `typeof __host[name] !== "function"`,
instead of `undefined is not a function`. Catches anything the static derivation
missed (dynamic use) and turns it into a clean, surfaced error.

## SD-4 — OTA as a state machine (folds in CX-004/005/006)

- **Single active-bundle record** shared by app + widget:
  `{releaseId, minHostApi, sourceHash, signature, scheme}` (one JSON, replaces
  the loose `ota-meta.json`).
- **Atomic apply** (CX-006 / OP-1): stage source+bytecode+record under a temp
  dir → fsync → validate by loading in a throwaway runtime → atomically swap the
  active pointer; keep the previous known-good for rollback. **Bytecode is named/
  keyed by `sourceHash`**; load refuses a bytecode whose hash ≠ the active
  source (kills the "stale .qbc + new source" silent-wrong-code path).
- **Widget participates** (CX-004): `IntentRuntime` reads the *same* active
  record and applies the *same* gate at boot; if blocked it renders only the
  app-published static timelines and **never mutates** the App Group.
- **`applyUpdate` is request/response** (CX-005, via SD-1):
  `Promise<{accepted, activeReleaseId, reason}>` instead of fire-and-forget.

## Test plan (Linux-testable where possible)

- `VersionPolicy.decide`: matrix over {minHostApi <,=,> native} × {releaseId <,=,> highWater}.
- `minHostApi` derivation: fixture bundle importing a known capability set → expected max `since`.
- Signing interop: Node-signed `v2:` message verified by CryptoKit.
- Atomic apply: fault-injection at each write boundary leaves the prior version intact.
- Widget gate: blocked bundle ⇒ no App-Group writes.

## Future axis — data-schema gate (design for it now, build it later)

No DB today, but one may come. When it does, add a **third gate axis** mirroring
the capability gate on the data side, so the version model never needs reworking:

- On-disk **`dataSchemaVersion`** — highest schema the stored data has been
  migrated to (monotonic; advanced by a JS-owned migration that runs on boot).
- Each bundle declares the **data-schema range** it supports
  (`[minDataSchema, maxDataSchema]`).
- **Lower gate on the data axis:** refuse a bundle whose `maxDataSchema <
  dataSchemaVersion` — JS too *old* for the data on disk (the original "old
  code, new data" corruption you care about). When the bundle is *newer*
  (`minDataSchema > dataSchemaVersion`), run forward migrations on boot before
  mounting.
- Slots beside the existing axes — `releaseId` (freshness/rollback),
  `hostApiVersion`/`minHostApi` (capability), `dataSchemaVersion`/`[min,max]`
  (data) — all through one `VersionPolicy.decide`.

**To not paint ourselves in now:** make the active-bundle record an extensible
**struct** (not bare ints), so adding `dataSchemaVersion` later is purely
additive. That's the only thing we must get right today.

## Deferred / explicitly out of scope

- Implementing the data axis above — no DB exists yet; just leave room for it.
- Per-capability *partial* degrade (run the bundle but disable just the missing
  capability) — rejected; the owner chose hard "update the app", simpler + safer.

## Open

- Exact "Update the app" UX copy + whether to deep-link to the App Store page.
- Whether `hostApiVersion` bumps live in `schema.mjs` (single source) and
  generate the native constant — preferred, ties to SD-6.
