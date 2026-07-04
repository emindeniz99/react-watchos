# Consumer feedback for react-native-watchos

Written by the **ctrl-a-remote** project (`projects/ctrl-a-remote`), the first
real app built on this renderer. It's a presentation clicker: a watch remote UI
on this engine + a BLE link to a desktop companion. This doc is the friction and
the wins from actually consuming the renderer, with concrete asks. Priorities:
**P0** = blocks/penalizes every consumer, **P1** = real papercut, **P2** = nice.

## New findings — the BLE bridge (from a deeper read of `BluetoothBridge.swift`)

Two reliability gaps in the otherwise-great BLE central — **both now
resolved ✅**:

1. **Writes are `.withoutResponse` only — resolved ✅.** `bleWrite` now takes a
   `confirm` option: `{ confirm: true }` forces an acknowledged
   `.withResponse` write whose promise settles on the peripheral's ack
   (correlated FIFO per characteristic in `BleSession`, Linux-tested),
   `{ confirm: false }` forces fast fire-and-forget, and the default picks
   `.withResponse` when the characteristic supports it. A confirmed "Next"
   can no longer be dropped silently.

2. **No auto-reconnect after a drop — resolved ✅.** An unexpected drop
   (range/power) now auto-reconnects: in-flight promises settle with a clean
   reject, desired subscriptions are remembered and re-applied on the new
   link, and a deliberate `bleDisconnect` stays down (the `BleSession` latch,
   Linux-tested). A failed connect attempt also drains its queued ops instead
   of hanging them. The remote "just reconnects," as users expect.

Also: thanks for adding `A11yProps` — Ctrl-A now labels its icon-only
Prev/Next buttons with `accessibilityLabel`.

## Update — packaging shipped, ctrl-a-remote migrated onto it ✅

The P0 packaging landed (`exports` with `.` / `./build` / `./testing`,
`peerDependencies`, the compiled `lib/`, the pnpm workspace + examples).
**ctrl-a-remote now consumes the package** via a small pnpm workspace
(`workspace:*` to the sibling renderer), importing `react-native-watchos` +
`react-native-watchos/testing` and building with the `react-native-watchos/build`
preset — all the old source-reach-in glue (renderer `alias`, tsconfig `paths`,
hand-mapped react types) is gone, and `resolve.dedupe` in vitest is the only
extra setting. 20 tests + tsc + lint + bundle green. Big improvement — and the
`./build` fix + committed `lib/` from the last round both landed, thank you.

One thing worth documenting, learned the hard way — **now resolved ✅**:

- **Local consumption used to be pnpm-workspace-only.** Originally the `.`
  export pointed at a compiled `lib/` built on `prepare` (uncommitted), and npm
  ran the linked package's `prepare` on install (failing without the renderer's
  dev deps) — so an npm `file:`/`link:` consumer couldn't work, only a workspace
  member. **The renderer now ships source (build-free): `.` resolves to
  `src/index.ts` for every condition, and the `prepare`/`build-lib`/`lib/` are
  gone.** So external consumers no longer hit the prepare-or-missing-`lib/`
  trap. Thank you — that was the last real gap.

  (ctrl-a-remote consumes via a small pnpm workspace, which stays clean: zero
  per-tool glue. A plain npm `file:` consumer now also works build-free, needing
  only the usual single-React settings — esbuild `nodePaths`, vitest
  `resolve.dedupe`, tsc `preserveSymlinks` — for an out-of-workspace link.)

## One-line verdict

**It's a framework wearing a source folder's clothes.** The hard, impressive
parts — the reconciler, the native bridges (BLE/sensor/TimerText), the pinned
wire contract — are done well. The missing part is the boring packaging that
turns "clone the repo and wire it up" into "`npm i react-native-watchos`."

---

## P0 — Make it a real library (this was our single biggest friction)

`js/` has `"name": "react-native-watchos"` but no `main`/`exports`/build
artifact, so a consumer cannot import it as a package. To build ctrl-a-remote we
had to:

- import renderer **source** by relative path (`../../react-native-watchos/js/src`);
- add esbuild `nodePaths` + an `alias` to force a **single React instance** —
  two copies silently break hooks/context (we hit this; symptom is subtle);
- replicate those aliases in `tsconfig` **and** `vitest.config`, and hand-map
  `react` / `react-reconciler` types so `tsc` resolves them across the project
  boundary.

That's ~30 lines of fragile glue every consumer will re-derive. Asks:

1. **Publish a consumable package.** At minimum add `exports` (point at source
   for bundler consumers); better, ship a built `dist` + `.d.ts`. Add
   `"peerDependencies": { "react": "...", "react-reconciler": "..." }` and
   document/enforce React **dedupe** so consumers can't double-instantiate it.
2. **Export the build preset.** We copied `scripts/config.mjs` almost verbatim
   (shim `inject`, `es2020`, `platform: "neutral"`, the IIFE format). Ship it as
   `react-native-watchos/build` (or a small CLI) so the QuickJS-correct bundle
   config isn't copy-pasted.
3. **Provide a consumer template / example that isn't the demo.** A
   `create-react-watchos-app` or a documented "minimal external app" so the
   watch-target wiring (bundle path, Info.plist keys, App Group, scheme) is one
   command, not README archaeology.

**Why it matters:** items 1–3 delete *all* the glue above. This is the highest
leverage change you can make for adoption.

## P0 — Expose a typed host/extension surface

We wanted an app-level capability and had to reach into `globalThis.__host`
directly because `getHost()` isn't exported. The `__host` op channel +
`registerNativeListener` push pattern is genuinely the right extension model —
so make it **public and typed**: export `getHost()`, the host-op typing, and a
documented "how to add a native capability" recipe. Right now the clean
internal pattern is invisible to consumers.

---

## What works well (keep doing this)

- **The native-event + bridge architecture is the right shape.** When we needed
  Bluetooth, `bleConnect` / `bleWrite` / `onBleState` already existed and we
  **deleted all of our custom Swift**. That is the dream outcome. The
  `__host.<op>(json)` channel out + `__pushNativeEvent` / `registerNativeListener`
  in (committing via `runSync`) is clean and composable — lean into it as *the*
  extension primitive for every new capability.
- **`TimerText`** removed a whole class of pain — a self-ticking clock with zero
  per-frame JS. The `until` (countdown) variant powered a feature directly.
- **The wire contract is well-pinned** (render-schema tests, swift-tests
  fixtures, codegen drift check). As a consumer that gave real confidence the
  format wouldn't shift under us.
- **Honest "uncompiled Swift" labeling + Linux-testable pure cores.** We copied
  this culture for ctrl-a-remote's Swift/Rust and it's genuinely good practice.

---

## P1 — Papercuts with concrete fixes

1. **Document the async-commit model.** We burned real time discovering that a
   bare `setState` / microtask does **not** flush — only synchronous paths
   (`render`, `dispatchEvent`), the scheduler's real timers, and `runSync` do.
   The failure surfaced as the cryptic *"Expected host context to exist"*. You've
   since added `setInterval` shims and a host-context fix, but a short
   **"how updates commit"** doc (with: use `TimerText` for clocks, native pushes
   for external state) would save the next consumer hours.
2. **Promote a testing utility.** `runApp(element, host)` + `MemoryHost` is
   exactly the right test entry. But every consumer re-writes `findByType` (it
   lives in test-internal `helpers.ts`). Export a small query helper
   (`findByType`, maybe `findByText`) as `react-native-watchos/testing`.
3. **Document serialization quirks for anyone writing tree assertions.** Two
   surprised us: `Text` content folds into `props.text` (not `children`), and
   function props serialize to `true`. One paragraph in the docs is enough.

## P1 — Version the wire protocol visibly

`SerializedTree.v` exists — please **bump it on any shape change** and have the
Swift target / runtime surface a renderer-vs-runtime **mismatch loudly**. In a
consumer the JS bundle and the native target version independently, so a silent
schema drift is a debugging nightmare.

---

## Actionable checklist

- [ ] P0 `package.json`: add `exports` (+ ideally built `dist` + types) and
      `peerDependencies` for react / react-reconciler; document React dedupe.
- [ ] P0 Export the esbuild/QuickJS build preset (`react-native-watchos/build`).
- [ ] P0 Consumer template or minimal external-app example (not the demo).
- [ ] P0 Export `getHost()` + host-op types + a "add a native capability" recipe.
- [ ] P1 Docs: "how React updates commit" (sync paths / timers / `runSync`).
- [ ] P1 Export `react-native-watchos/testing` (`findByType`, query helpers).
- [ ] P1 Docs: serialization quirks (`Text` → `props.text`, fn props → `true`).
- [ ] P1 Enforce + surface `SerializedTree.v` mismatches loudly.

— ctrl-a-remote (see its README + `docs/architecture.md` for how it consumes the
renderer: relative-source import, `nodePaths`/alias single-React trick, the BLE
bridge, `TimerText`, and the native-event connection channel).
