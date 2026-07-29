# react-reconciler version matrix (ARCH-14)

React reconciler internals are **not a stable public renderer API**: host
config members, factory exports and even the event-priority lane values
move between `react-reconciler` minors, and the published typings
(`@types/react-reconciler`) describe a different contract than the runtime
they are numbered for. The mitigation is three-legged:

1. **One adapter boundary** — [`js/src/reconcilerAdapter.ts`](../js/src/reconcilerAdapter.ts)
   is the only module allowed to import `react-reconciler` /
   `react-reconciler/constants`, and holds the package's **single unsafe
   cast** (the factory bridge). Everything else — `renderer.ts` included —
   consumes its fully-typed surface (`WatchHostConfig`, `WatchReconciler`,
   typed priority constants).
2. **Exact pinned versions** — the runtime peer is `react-reconciler:
   "0.33.0"`, not a range: the cast means tsc cannot see a contract change,
   so only versions that went through the procedure below may install.
3. **This matrix** — the record of which combinations are actually tested,
   and how to add a row.

`test/reconcilerAdapter.test.ts` enforces all three (import boundary, the
exact pins, and the runtime's lane values) so drift fails CI rather than a
watch.

## Tested matrix

| react | react-reconciler | @types/react-reconciler | status |
| --- | --- | --- | --- |
| `^19.2.0` (19.2.3 in lockfile) | `0.33.0` (exact) | `^0.32.0` (0.32.3) | ✅ tested 2026-07-17 — vitest suite (410) + `tools/embed-smoke/run.sh` (quickjs-ng: app + widget + bytecode boot, dispatch/nav transaction, heap + boot budgets) |
| `^19.2.0` (19.2.3 in lockfile) | `0.33.0` (exact) | `^0.33.0` (0.33.0) | ✅ tested 2026-07-29 — vitest suite (646) + swift 374 + `tools/embed-smoke/run.sh` (quickjs-ng: app + widget + bytecode boot, dispatch/nav transaction, heap 2.1 MB, boot 33.3 ms source / 9.2 ms bytecode) + both examples' bundles built and booted |

`react` and `react-reconciler` are a lockstep pair (0.33.0 is cut from the
React 19.2 tree and reports `reconcilerVersion: "19.2.0"` to DevTools);
never bump one without the other.

The react cell is one version for the WHOLE workspace, not just `js/`. `app/`
and `examples/expo-watch-app` pin react exactly (`19.2.3`, what `expo install`
wrote), so a caret floor in `js/` that resolves above that pin gives those
consumers two react copies in one watch bundle — the reconciler binds the
hooks dispatcher to one and the app's components read the other, so the first
`useState` throws and the watch renders nothing. That shipped once: `7fe2d57`
moved the `js/` and `examples/minimal-watch-app` floors to `^19.2.8` as a
"dev/test only" patch bump, and the Expo example's bundle went to 8×19.2.3 +
12×19.2.8 records and died at boot in real QuickJS. Both floors are back at
`^19.2.0`; the two patches build byte-identical bundles (611434 B either way),
so the bump bought nothing the fragmentation was worth. `test/reconcilerAdapter.test.ts`
now pins the dev floor as well as the peer range, and every build through the
preset fails if the module graph contains more than one react
(`js/esbuild/single-copy.mts`) — the gate that was missing.

## The types/runtime mismatch (why the adapter still casts)

**Measured 2026-07-29 at `@types/react-reconciler@0.33.0`.** The typings
finally carry the runtime's own version number — so the obvious question is
whether ARCH-14's single unsafe cast can go. It cannot. The method: delete
the cast (`const createReconcilerInstance = Reconciler;`), run
`tsc -p tsconfig.json`, and read what the compiler says; then check every
claim below against the installed
`node_modules/@types/react-reconciler/index.d.ts` and the runtime's
`cjs/react-reconciler.{development,production}.js`.

### Resolved by @types 0.33.0

Two of the old rows are genuinely fixed, and the notes for them have been
deleted from `reconcilerAdapter.ts`:

- **Reconciler instance exports** — `updateContainerSync` and `flushSyncWork`
  are now declared on the `Reconciler` interface (both were absent in 0.32).
  `flushPassiveEffects` was **not** part of this fix — 0.32.3 already declared
  it at `index.d.ts:1014`; it was never a drift row.
- **`createContainer` arity** — now declares the real 10 parameters ending
  in `onDefaultTransitionIndicator`. 0.32 declared 11, with a trailing
  `transitionCallbacks` the 0.33 runtime does not accept.

### Surviving drift — each proven by a tsc error

Removing the cast produces **six** errors, not zero:

| # | Error | What is wrong |
| --- | --- | --- |
| 1 | `TS2345` on the host config | `HostConfig` still **requires** `getInstanceFromNode`, `beforeActiveInstanceBlur`, `afterActiveInstanceBlur`, `prepareScopeUpdate`, `getInstanceFromScope` (no `?`). The 0.33 runtime tolerates all five missing — this renderer provides none, and the suite + embed smoke prove absence is fine. |
| 2 | `TS2554` at `injectIntoDevTools()` | Typings still declare `injectIntoDevTools(devToolsConfig)`. The runtime's function has `.length === 0` — it takes **no** arguments, and reads the renderer identity from the host config's `rendererVersion` / `rendererPackageName` / `extraDevToolsConfig` instead. |
| 3–4 | `TS2339` ×2 | `defaultOnCaughtError` / `defaultOnRecoverableError` **are** declared in 0.33 — but as module-level functions. At runtime they live on the reconciler **instance** (confirmed: they appear in `Object.keys(instance)`, and the module namespace has no such export), which is where the adapter reads them. |
| 5 | `TS2345` at `onDefaultTransitionIndicator` | Typed non-nullable `() => void`; the runtime accepts `null`, which is what this renderer passes (no pending-transition UI). |
| 6 | `TS6196` | `ReconcilerExports` becomes unused — the bookkeeping consequence of the above, not an independent finding. |

Beyond what tsc reports, still wrong but not load-bearing at the call sites
we use:

- **`flushSync` is declared but does not exist at runtime.** Both 0.32.3 and
  0.33.0 declare `flushSync(): void` / `flushSync<R>(fn: () => R): R` on the
  `Reconciler` interface (0.33.0 `index.d.ts:1016-1017`). The 0.33 runtime
  instance has no such member: `Object.keys(instance)` yields
  `flushPassiveEffects`, `flushSyncFromReconciler`, `flushSyncWork` — and
  neither cjs build contains a bare `flushSync` identifier at all. Nothing
  here calls it, so it costs no tsc error, which is exactly what makes it
  dangerous: adding `flushSync` to `ReconcilerExports` plus a passthrough
  typechecks green and lints green (the cast hides it), then fails only as
  `TypeError: reconciler.flushSync is not a function` inside QuickJS on the
  watch. **If a sync flush is ever needed, use `flushSyncFromReconciler`.**
- **HostConfig lacks members the runtime reads.** Absent from the 0.33
  typings, present as `$$$config.*` reads in *both* runtime builds:
  `maySuspendCommitOnUpdate`, `maySuspendCommitInSyncRender`,
  `bindToConsole`, `suspendOnActiveViewTransition`, `rendererVersion`,
  `rendererPackageName`, `extraDevToolsConfig`.
- **Signature drift**, verified at the runtime's invocation sites:
  `getChildHostContext(context, fiber.type)` — 2 args, the typings still
  declare 3; `preloadInstance(stateNode, type, props)` — gained a leading
  instance, typings declare `(type, props)`; `suspendInstance(suspendedState,
  instance, type, props)` — typings declare `(type, props)`;
  `waitForCommitToBeReady(suspendedState, timeoutOffsetMs)` — typings
  declare no parameters.
- **Stale constant VALUES.** `constants.d.ts` ships **byte-identical** to
  0.32: Discrete/Continuous/Default/Idle as `1 / 4 / 16 / 2^30`, where the
  runtime module really exports `2 / 8 / 32 / 2^28`. This is the row most
  likely to bite a consumer who imports the constants directly; the adapter
  re-exports erase the stale literal types and
  `test/reconcilerAdapter.test.ts` pins the runtime values.
- **`OpaqueRoot` is `any`.** Adopting the library's root type would be a
  *downgrade* — the adapter's branded `OpaqueRoot` is what stops an
  arbitrary value being passed back into `updateContainerSync`.
- **Generic erasure.** The factory infers `HostConfig<unknown × 14>`, so
  even a host config that satisfied row 1 would yield
  `Reconciler<unknown, …>` with `createContainer(containerInfo: unknown)` —
  losing the `Container` typing this adapter provides.

### Verdict

The cast **stays**, and so does the exact pin. Routing through the library
types would need *two* casts (host config in, instance out) and would lose
the branded root plus the `Container` generic — strictly worse than the one
cast at the factory. What the upgrade did buy is a shorter drift list, but
not a clean instance API: the bulk moved to the HostConfig and DevTools
surfaces, while the instance still carries rows 3–4 (`defaultOn*Error`
declared module-level) and the declared-but-absent `flushSync`. Upstream fixing
rows 1, 2 and 3–4 would be enough to revisit this decision; rows 1 and 2 are
the load-bearing ones.

Why keep `@types/react-reconciler` at all: it types the
`react-reconciler/constants` import inside the adapter (without it the
package is implicit-`any` under strict tsc), and the project rule is to
prefer a published type package over a hand-written shim — the adapter
corrects it *where it is wrong* rather than replacing it wholesale. It
lives in `dependencies` (not dev) because the package ships TypeScript
source, so consumers' typecheckers resolve the adapter's imports too.

## Upgrade procedure

1. Open [`js/src/reconcilerAdapter.ts`](../js/src/reconcilerAdapter.ts).
   Bump `react` + `react-reconciler` (+ `@types/react-reconciler` if a new
   major exists) **together** in `js/package.json` (peer + dev pins) — and in
   the same commit move `app/` and every `examples/*` consumer to the same
   version, or the ones left behind resolve a second react copy into their
   bundle (the preset's single-copy check will refuse to build it).
2. Diff the new runtime's host-config contract against `WatchHostConfig`
   and `ReconcilerExports`:
   `grep -o '\$\$\$config\.[A-Za-z]*' node_modules/react-reconciler/cjs/react-reconciler.production.js | sort -u`
   for membership, then read the call sites of anything the renderer
   provides (both dev and prod builds — several members are dev-only).
3. Update `WatchHostConfig` / `ReconcilerExports` (and `renderer.ts`'s
   `hostConfig` if the runtime now requires new members — the annotation
   makes tsc list exactly what's missing/extra).
4. Run the gates: `pnpm run typecheck && pnpm run lint && pnpm exec vitest
   run`, then `pnpm run build` and `sh tools/embed-smoke/run.sh` from the
   project root (the real-engine proof).
5. Fix the pinned versions + lane values in
   `test/reconcilerAdapter.test.ts` (they are *supposed* to fail on a
   bump).
6. Add a row to the matrix above with the date and gate evidence.

## Dependency statement (deliberately unchanged)

`react-reconciler` stays a **peerDependency at the exact pin `0.33.0`**
(mirrored as a devDependency for our own gates):

- *Peer, not regular dependency:* the consumer's bundler must resolve ONE
  reconciler copy shared with whatever else touches it, and the peer
  declaration surfaces the exact requirement to their resolver instead of
  nesting a hidden second copy.
- *Exact, not a range:* the adapter's cast blinds tsc to contract changes,
  so the pin is what guarantees only matrix-tested versions ever install.
  The 2026-07-01 alternatives review (NF-36) flags the exact pin as a
  dedupe footgun and suggests `~0.33.0` plus a runtime dual-copy
  assertion; that stays the documented revisit path — do it only together
  with that assertion, and treat every patch bump as a matrix row (steps
  above), since the cast hides even patch-level contract drift.
