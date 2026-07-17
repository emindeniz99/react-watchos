# react-reconciler version matrix (ARCH-14)

React reconciler internals are **not a stable public renderer API**: host
config members, factory exports and even the event-priority lane values
move between `react-reconciler` minors, and the published typings
(`@types/react-reconciler`) lag a full major behind. The mitigation is
three-legged:

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

`react` and `react-reconciler` are a lockstep pair (0.33.0 is cut from the
React 19.2 tree and reports `reconcilerVersion: "19.2.0"` to DevTools);
never bump one without the other.

## The types/runtime mismatch (why the adapter casts)

`@types/react-reconciler@0.32` describes react-reconciler 0.32; the pinned
runtime is 0.33. Verified against the installed
`cjs/react-reconciler.{development,production}.js` (grep the factory's
`$$$config.*` reads and the call sites), 2026-07-17:

- **Instance exports:** 0.33 exports `updateContainerSync`, `flushSyncWork`
  and `defaultOn{Caught,Recoverable,Uncaught}Error` — absent from 0.32's
  `Reconciler` interface (whose `flushSync(fn)` overload is gone in 0.33).
- **`createContainer`:** 10 parameters ending in
  `onDefaultTransitionIndicator`; 0.32 declares 11 (a trailing
  `transitionCallbacks` that 0.33 does not accept).
- **`injectIntoDevTools()`:** takes **no arguments** in 0.33 — bundleType
  comes from which build (dev/prod) is bundled, and the identity from the
  host config's `rendererVersion` / `rendererPackageName` /
  `extraDevToolsConfig` (fields the 0.32 `HostConfig` doesn't have). The
  0.32 signature (`injectIntoDevTools(devToolsConfig)`) typechecks an
  argument object that 0.33 silently ignores — the pre-ARCH-14 renderer
  was passing exactly such a dead object.
- **HostConfig membership:** 0.32 *requires* members 0.33 tolerates missing
  (`getInstanceFromNode`, `beforeActiveInstanceBlur`,
  `afterActiveInstanceBlur`, `prepareScopeUpdate`, `getInstanceFromScope`)
  — one reason the old `as never` existed — and *lacks* members 0.33 reads
  (`maySuspendCommitOnUpdate`, `maySuspendCommitInSyncRender`,
  `bindToConsole`, `suspendOnActiveViewTransition`, the DevTools identity
  fields, the view-transition/fragment/gesture families).
- **Signature drift:** `getChildHostContext` is `(parent, type)` (the
  `rootContainer` argument is gone); `preloadInstance` gained a leading
  `instance`; `suspendInstance` is `(suspendedState, instance, type,
  props)`; `waitForCommitToBeReady` takes `(suspendedState,
  timeoutOffsetMs)`; `bindToConsole` is called `(methodName, args,
  badgeName)`.
- **Stale constant values:** 0.32's `constants.d.ts` declares
  Discrete/Continuous/Default/Idle as `1 / 4 / 16 / 2^30`; the 0.33 runtime
  ships `2 / 8 / 32 / 2^28`. Runtime values are correct (they come from the
  real module); the adapter's re-exports erase the stale literal *types*,
  and the adapter test pins the runtime values.

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
   major exists) **together** in `js/package.json` (peer + dev pins).
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
