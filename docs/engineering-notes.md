# Engineering notes & learnings

The non-obvious things this project found out the hard way — kept because each
one changes a decision someone would otherwise re-derive.

*(Relocated from the README's "Notes / learnings", 2026-07-29 — unchanged in
substance.)*

- React 19 + react-reconciler 0.33 run unmodified in QuickJS (even
  Bellard's 2021 build) once `queueMicrotask`/`setTimeout`/`console` shims
  exist — see `js/src/shims.ts`.
- React swallows render errors into `onUncaughtError` on concurrent roots;
  `WatchRoot` rethrows so a broken watch UI fails loudly. (What that looks
  like on-wrist: [debugging.md](./debugging.md).)
- react-reconciler's host-config surface churns between minors — it is
  pinned exactly, and `js/test/render.test.tsx` locks the wire schema. The
  tested matrix and the upgrade procedure are in
  [reconciler-version-matrix.md](./reconciler-version-matrix.md).
- The Espruino/Bangle.js community ran React for a 64KB watch by keeping
  React on the phone; Apple Watch has the RAM to skip the Bluetooth hop
  entirely.
- Raycast's extension pipeline (custom reconciler → JSON render tree →
  native views, registered-messages-only IPC) independently validates this
  architecture at scale; their tree-diffing and process isolation are the
  upgrades to reach for if trees grow or the JS becomes untrusted — see
  [research.md](./research.md) and [prior-art.md](./prior-art.md).
- esbuild evaluates imported module bodies before the entry's statements,
  so React's scheduler captures `setTimeout` at module init — the QuickJS
  shims are therefore force-prepended via esbuild's `inject` option
  (`scripts/config.ts`), not by import-order convention.
- Injection is unconditional bundling, so the **network** shims
  (`fetch`/`Headers`/`AbortController`) sit behind a build-time gate the
  injected module branches on (`network: false` on a preset target, or
  `--no-network`). A bundle whose declared capability contract has no
  `network` — the widget extension, `["storage","widgets"]` — was carrying
  3,798 B of a fetch it can never call; the repo's own build derives the flag
  from `requiredFeatures` so the contract stays the single source of truth. A
  runtime check would have saved nothing: only *not bundling* is a saving.
- The same lever, for dev-only wiring: `process.env.REACT_WATCH_DEV` is "1" in
  a dev build and "" in a shipping one (`dev`, defaulting to `!minify`), so
  `if (process.env.REACT_WATCH_DEV) { … }` in an entry compiles the branch —
  and everything only it imported — out of the release bundle. The remote
  inspector was the case that paid for it: 1,307 B that shipped because a
  static import outlives a dead call site. `NODE_ENV` cannot serve here; it is
  pinned to `"production"` in every build, dev included, because React's dev
  bundle is too heavy and chatty for the watch.
- The build runs the **React Compiler** (`babel-plugin-react-compiler`) —
  a published preset flag, so consumers get it too:
  `watchBuildOptions({ reactCompiler: true })` (needs the Babel dev deps —
  see `esbuild/react-compiler.mts`; the demo and the expo example both
  enable it). Auto-memoization means React re-renders less and emits fewer
  commits — fewer serialize/decode trips across the bridge, compounding
  with the renderer's wire-identical commit skip. React 19 ships the
  compiler runtime, so it adds ~7 KB minified and no new runtime dependency.
- `npm run build:bytecode` precompiles the bundle to QuickJS bytecode
  (`bundle.qbc`) so cold start skips the parser — the watch-sized analog of
  Hermes AOT. The watch/widget runtimes load `.qbc` if present and fall back
  to parsing `.js`. Trade-offs: bytecode is ~4× larger on disk (~2 MB vs
  ~480 KB) and is coupled to the vendored quickjs-ng version, so it's a
  build artifact (git-ignored), regenerated from the vendored sources at
  package time — never committed.
- The JS↔Swift wire model and `__host` surface are generated from one
  schema (`js/codegen/schema.ts`) into the Swift models and TS types; a
  drift test and a host-method cross-check keep the two languages in sync.
- **Threading.** QuickJS runs on the main thread; committed trees are
  decoded on a serial background queue (`decodeQueue`) and only `@Published`
  state is touched back on main, so the JSON-parse cost of large trees
  doesn't block the UI. Running the JS engine itself off the main thread
  (RN's JS-thread model) is deferred: it's a Swift-6 actor-isolation–
  sensitive change that can't be verified in this Linux environment, and at
  watch-tree scale the engine work is sub-millisecond. Revisit once the
  macOS build can compile/run it.
- Since shipped (this list used to call them "future"): WatchConnectivity on
  the watch side (`sendToPhone` + phone→watch pushes — the iPhone companion's
  WCSession wiring is what remains), minified bundles (`build:min` + the CI
  size budget), and QuickJS inside the widget extension for app-closed
  timeline refreshes (`WidgetIntentRuntime`). Still future: Hermes if it ever
  grows a watchOS target — the argument for why that window may never open is
  in
  [system-architecture-review-2026-07-01-alternatives.md](./system-architecture-review-2026-07-01-alternatives.md)
  §2.1.
