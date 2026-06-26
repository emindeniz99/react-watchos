# ARCH-02 — explicit capability contract (design + status)

ARCH-02 replaces import-derived `requiredFeatures` with an **explicit, declared
capability contract per artifact**, build-checked so an undeclared capability
fails loud. This note records the decision, what's **done**, and a soundness
problem found while scoping it that the contract design must account for.

Source decision: [system-architecture-review …codex.md, ARCH-02](./system-architecture-review-2026-06-25-1859-codex.md).

## Acceptance criteria & status

1. [ ] `watchReleaseConfig` — required/optional features declared per entrypoint.
2. [ ] Generated wrappers/primitives emit stable feature markers.
3. [ ] Build analysis as a **consistency check** against the explicit manifest.
4. [x] **Reject direct raw `__host` access from app code.** Guarded by
   [`no-raw-host.test.ts`](../js/test/no-raw-host.test.ts): the demo (canonical
   consumer) reaches capabilities only through the typed API; the raw bridge is
   owned by the framework's binding layer (`js/src/*`). This is the **enabling**
   criterion — see "Why #4 first" below.
5. [ ] Sign the final declared feature sets with the release.

## The soundness hole (found while scoping #2/#3)

The tempting cheap implementation of #3 — "derive a bundle's features from its
module graph (esbuild metafile) or its imports" — is **unsound in this
codebase**, and not for the reasons the review listed (re-exports, wrappers).
The decisive reason:

- Several capability modules **self-register on `globalThis` at module top
  level** — e.g. `ai.ts` sets `__resolveGenerate`/`__rejectGenerate`,
  `invoke.ts` installs the invoke bridge, `fetch.ts`/sensors wire settlers.
  These are **side effects**, so esbuild **cannot tree-shake them** even when the
  app never calls the capability.
- Result: the module graph (and any import-presence scan) reports **every
  capability as present in every bundle** → derived `requiredFeatures` would be
  the full set, always. The check would be useless (or, if trusted as authority,
  would over-gate every OTA bundle).

So "module/import presence ⇒ feature required" must **not** be the authority. A
sound usage signal needs either real call-graph analysis (call sites of
`generateText`/`fetch`/…), or **markers emitted at the call/wrapper site** (not
at module load) — which is what criterion #2 ("stable markers") should mean.

## Recommended shape (for owner review before building #1–3,5)

- **Declaration is the authority** (#1). Add `features: string[]` (required) +
  optional per target in `scripts/config.mjs`; that is the signed contract (#5,
  rides the CX-007 manifest signature).
- **Sound build-check** (#3), two layers:
  - **declared ⊆ native-provided** (`HostFeatures.<target>`): fail the build if
    an artifact declares a feature no native target provides (you can't OTA a
    capability the binary lacks). This is sound and needs no usage-derivation.
  - **declared ⊇ used** (advisory): only with a *sound* usage signal — call-site
    markers (#2) or call-graph analysis. Until then, keep it a warning, never
    the gate, so the side-effect hole above can't silently widen the contract.
- **Markers** (#2): emit a marker at each capability's **public entry function**
  (or a codegen'd wrapper), e.g. a `/* @uses:network */` annotation the bundle
  scan can attribute to a *call*, so presence reflects usage, not module load.
- #4 (done) is the precondition for all of the above: with the raw bridge
  forbidden in app code, the typed entry functions are the *only* path to a
  capability, so marking/analyzing them is complete.

## Why #4 first

Every other criterion assumes the typed API is the sole route to native
capabilities. If app code could call `globalThis.__host.<x>()` directly, no
declared contract or static check could ever see that use. Locking #4 in (and
keeping it green in CI) is the foundation the contract stands on; the rest is a
deliberate, owner-shaped pass — not a blind overnight build, given the soundness
subtlety above.
