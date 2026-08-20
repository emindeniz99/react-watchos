# Getting started — running it, consuming it, building it

Everything between "I cloned this" and "it renders on a watch": the workspace
commands, adding the renderer to your own app, the native (Expo plugin +
scaffold) setup, the consumer tsconfig contract, and the macOS/Xcode path.

*(Relocated from the README, 2026-07-29 — unchanged in substance. The README
keeps the five-line quick start and links here. The npm-package-facing version
of the same material lives in the [package README](../js/README.md).)*

## Where things live

| Path | What |
|---|---|
| `js/` | The renderer + demo app (pure TypeScript, tested on any OS) **and** the SwiftPM host under `js/swift/` — both ship in one npm package. |
| `js/swift/` | The Swift host as a **SwiftPM package**: `CQuickJS` (quickjs-ng as a Clang module), `ReactWatchCore` (codegen'd wire models), `ReactWatchSupport` (Foundation platform logic — storage/optimistic/notifications), `ReactWatchRuntime` (the QuickJS embedding) — all Linux-built + `swift test`ed — plus two macOS-gated products: `ReactWatchHost` (SwiftUI interpreter + bridges + `ReactWatchRootView`) and `ReactWatchWidget` (WidgetKit infra: timeline providers + the extension's QuickJS runtime). |
| `app/` | Expo SDK 57 iOS shell; the watch app is a [`@bacons/apple-targets`](https://github.com/EvanBacon/expo-apple-targets) target that depends on the `js/swift/` package and is a thin `@main`. |
| `app/targets/widget/` | WidgetKit extension: decodes React-rendered timelines from App Group storage (`ReactWidgets.swift`, `WidgetNodeView.swift`); imports `ReactWatchCore`. |
| `examples/` | External-consumer templates (`minimal-watch-app`, `expo-watch-app`), each a workspace member. |
| `tools/embed-smoke/` | Reference C host: compiles the package's quickjs-ng and runs the real bundle through the exact API sequence Swift uses. |
| `tools/qjs-compile/` | Compiles the bundle to QuickJS bytecode (`bundle.qbc`) with the *vendored* engine, so the shipped bytecode version always matches the runtime; the watch app + widget prefer it over the source (`pnpm build:bytecode`, wired into `prebuild`). |
| `js/swift/Tests/` | The package's `swift test` wire-contract tests: decode real serializer fixtures with the codegen'd `ReactWatchCore` models on Linux. |
| `docs/api/` | **Generated API reference** (M12) — every export + type from the TS source via typedoc (`pnpm docs:api`), plus `capabilities.md`, the component/host-method tables emitted from `codegen/schema.ts` so they can't drift. |

## JS side — works on Linux/macOS/anywhere

This project is a **pnpm workspace** (`js` = the renderer, `examples/*` =
consumer apps, `app` = the reference watch app). Run from the project root:

```bash
pnpm install                                 # one install for every member
pnpm --filter react-watchos test      # full suite, incl. real qjs smoke
pnpm --filter react-watchos typecheck  # strict tsc: src + tests
pnpm --filter react-watchos lint       # Biome (CI gate)
pnpm --filter react-watchos codegen    # Swift models + TS wire types
pnpm --filter react-watchos build      # bundle → both targets' assets/
pnpm --filter react-watchos build:bytecode  # precompile bundle.qbc
pnpm --filter react-watchos dev        # live reload on 127.0.0.1:8788
```

The demo's **Updates** screen reads `REACT_WATCH_OTA_URL` at build time. It is
the **manifest** URL — `checkForUpdate` fetches the JSON manifest and resolves
the bundle relative to it (so a `…/manifest.json` URL loads `…/bundle.js` from
the same directory). The dev server serves `dist/` statically, so both are
available. Point it at `manifest.json`, not the bundle:

```bash
# Simulator: localhost works.
REACT_WATCH_OTA_URL=http://127.0.0.1:8788/manifest.json \
  pnpm --filter react-watchos build

# Physical watch: bind the dev server to LAN and use your Mac's Wi-Fi IP.
DEV_HOST=0.0.0.0 pnpm --filter react-watchos dev
REACT_WATCH_OTA_URL=http://192.168.x.y:8788/manifest.json \
  pnpm --filter react-watchos build
```

> The generated `app/targets/*/assets/bundle.js` is **not** committed (it's
> gitignored). `pnpm --filter ... build` regenerates it, and `app`'s `prebuild`
> script runs that build first, so `pnpm prebuild` (and CI) always produce a
> fresh bundle before the Xcode build. Run `build` once before opening the
> Xcode project directly.

## Consuming it in your own app

The renderer is a real package: `exports` (main, `/build`, `/testing`),
`peerDependencies` for react / react-reconciler, and a typed host surface.

> **Toolchain: Node ≥ 22.18 (Node 24 recommended).** The app source ships as
> TypeScript that your bundler compiles — but the Expo config plugin, the CLI
> (`npx react-watchos`), and the esbuild preset (`react-watchos/build`) run in
> **your** Node and ship as `.cts`/`.mts` source, executed by Node's native
> type stripping. So `expo prebuild` and your bundle-build script need Node
> ≥ 22.18 (stripping is on by default) — or ≥ 22.6 with
> `--experimental-strip-types`. This is a pre-1.0 choice; a compiled-to-JS
> build can be added if older Node support is needed.

```ts
import { runApp, VStack, Text, Button, getHost } from "react-watchos";
import { findByType } from "react-watchos/testing";   // tree queries
import { watchBuildOptions } from "react-watchos/build"; // esbuild preset
```

- **Single React instance:** react / react-reconciler are peers — your app
  provides the one copy. What makes an install produce one copy is your
  `react` range *overlapping* the renderer's, in this workspace as much as
  outside it (`workspace:*` and the preset's `nodePaths` do not dedupe on
  their own). Two copies break hooks: the reconciler binds the dispatcher to
  one and your components read the other. The build preset checks the module
  graph and fails rather than emitting such a bundle.
- **No copied build config:** `watchBuildOptions({ entry, outfile })` is the
  QuickJS-correct esbuild preset (shim inject, es2020, neutral IIFE).
- **What minifies, and what doesn't:** the shipping entries minify by default —
  `buildBundles([…])` and `npx react-watchos build` (605 KB → 195 KB on the
  reference app, and a 1.4 MB QuickJS heap instead of 2.1 MB). `watchBuildOptions`
  and `npx react-watchos dev` do not, because minification renames locals and
  React's frame builder reads `fn.name`, so your components become `at t` in a
  stack. Opt out of the shipped one with `--no-minify` / `{ minify: false }`.
  The repo's OWN `pnpm --filter react-watchos build` (above) is the exception
  and stays unminified — `test/react-compiler.test.ts` reads that bundle's
  text; `build:min` is the minified in-repo artifact.
- **Extending natively:** `getHost()` + `QuickJSHostGlobal` are public — see
  [extending.md](./extending.md) for the "add a native capability"
  recipe, and [updates.md](./updates.md) for how updates commit.

**Native setup (Expo plugin + scaffold)** — no manual Xcode wiring, and no
hand-written target config (the plugin composes apple-targets internally and
*generates* the `expo-target.config.js` files — don't create them yourself):

1. `npx expo install react-watchos @bacons/apple-targets`
2. Add the `react-watchos` plugin to `app.json` — the ONLY plugin entry you
   need; do not also list apple-targets. Options inline:

   ```jsonc
   "plugins": [["react-watchos", { "name": "My Watch", "widget": true }]]
   ```

   (See [`examples/expo-watch-app/app.json`](../examples/expo-watch-app/app.json)
   for the working reference.)
3. `npx react-watchos scaffold` writes the `@main` Swift glue the plugin
   can't generate (`targets/watch/WatchApp.swift`, plus the widget bundle when
   the widget target is enabled).
4. `npx expo prebuild` — the plugin generates the target configs, creates the
   targets via apple-targets, links the SwiftPM products, and merges each
   target's Info.plist in one pass (no post-prebuild step).
5. Build your watch JS into the target's assets with
   `buildBundles([{ entry, outfile, manifest }])` — or
   `npx react-watchos build --entry … --asset …`. Both minify by default;
   reach for `watchBuildOptions` only to hand-assemble the esbuild call, and
   pass `{ minify: true }` when you do. Ship OTA updates by signing the
   manifest with `signManifest` from `react-watchos/manifest`.

## Host policy (least privilege for OTA bundles)

A signed OTA bundle runs with every native capability the host installs, so the
app — not the bundle — decides which features are authorized:

```swift
ReactWatchRootView(
  appGroupId: "group.example.watch",
  ota: OTAConfig(signerPublicKeys: ["k1": publicKey]),
  policy: .allow(["network", "storage", "widgets"])
)
// Widget extension (@main init), alongside the signer keys:
ReactWatchWidgetOTA.configure(
  signerPublicKeys: ["k1": publicKey],
  policy: .allow(["network", "storage", "widgets"])
)
```

`.allow` is an allowlist intersected with what the binary provides (the
default `.allowAll` changes nothing); the `core` infrastructure
(commit/log/timers/invoke) is always on, so a policy can't brick the runtime.
A blocked feature disappears from `__host` and `__hostFeatures` (the JS
update gate then reports it under `missingCapabilities` before downloading),
calls to it reject with the typed `POLICY_DENIED` error, and OTA staging
refuses bundles that require it — "requires an app configuration change",
i.e. enabling a sensitive feature (health, BLE, network, notifications, AI)
always takes a native release, never just a new bundle.

[`ota-signing.md`](./ota-signing.md) covers the rest of the update
channel: key generation and rotation, the health signal, and how this
JS-only, signed, capability-bounded design maps to **§3.3.1(B) of the
Apple Developer Program License Agreement** — what an OTA update may and
may not change.

Two worked examples (each its own workspace member, both verified on Linux):

- [`examples/minimal-watch-app`](../examples/minimal-watch-app) — the smallest
  consumer: watch UI only, imports the package, builds with the preset.
- [`examples/expo-watch-app`](../examples/expo-watch-app) — an Expo iPhone app
  that adds a watch target whose UI runs on this engine (the realistic shape).

## From outside the workspace

The package ships **source** (no build step, no `prepare` hook), so consuming
it from outside the workspace — a different repo/folder linking it via
`file:`/`link:`, or a registry `npm i` — works without building anything: your
bundler compiles the `.ts` directly.

**The source-shipping tsconfig contract (applies to EVERY consumer, registry
installs included):** because you compile our `.ts` as part of your program,
`skipLibCheck` does not exempt it — your tsconfig must be able to type-check
it. Concretely, your `lib` must cover the timer/console/fetch globals the
renderer uses — the standard Expo/web shape works:

```jsonc
// tsconfig.json — the contract every consumer of this package needs
{ "compilerOptions": { "lib": ["DOM", "DOM.Iterable", "ESNext"], "jsx": "react-jsx" } }
```

(`@types/node` is NOT required since 0.2.0 — the one `process` read carries
its own module-local declaration.) Without a covering `lib`, a strict config
fails with `TS2304` errors *inside the package*. Both in-repo examples carry
this shape.

A linked package additionally resolves through a symlink (realpath), so for
`file:`/`link:` your tools also need to dedupe React across that boundary.
Three settings, and that's the whole integration (not needed for a registry
install):

```js
// esbuild build: resolve the renderer's `react` to YOUR copy
watchBuildOptions({ entry, outfile, nodePaths: [join(root, "node_modules")] });
```
```ts
// vitest.config.ts
export default defineConfig({ resolve: { dedupe: ["react", "react-reconciler"] } });
```
```jsonc
// tsconfig.json — the easy one to miss. Without it, tsc follows the symlink to
// the renderer's source and can't find its react, so type-checking fails.
{ "compilerOptions": { "preserveSymlinks": true } }
```

Without `preserveSymlinks`, `tsc` type-checks the renderer's `.ts` source at
its real path (outside your `node_modules`) and can't resolve `react` there.
The first two prevent a second React copy in the bundle/tests (which silently
breaks hooks). Published to a registry (a normal `npm i`, no symlink) only the
`types: ["node"]` contract above applies — the symlink settings are specific
to linked local packages.

## Type safety & linting

- **TypeScript** runs at maximum strictness. `tsconfig.base.json` enables
  `strict` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noImplicitOverride`/`Returns`, `noFallthroughCasesInSwitch`,
  `noUnused*`, `verbatimModuleSyntax`, and `allowUnreachableCode: false`.
  `tsconfig.json` (production: `src`/`demo`/`scripts`/`codegen`) inherits all
  of it; `tsconfig.test.json` inherits everything **except**
  `noUncheckedIndexedAccess`, which is pure noise when asserting on
  just-built fixtures. `npm run typecheck` checks both.
- **Biome** is the linter + formatter (`biome.json`): recommended rules,
  double quotes, 2-space, 80 cols, organized imports. Generated wire types
  are excluded so it never fights codegen. Non-null assertions and `any` are
  allowed only under `test/**`.
- **Swift** contract tests build in Swift 6 language mode (strict
  concurrency) with `-warnings-as-errors`. Codegen formats generated Swift
  with Apple's `swift format` (`.swift-format`); the macOS workflow
  additionally lints with SwiftFormat + SwiftLint (`.swiftlint.yml`) —
  SourceKit isn't available on the Linux CI.

With `npm run dev` running, DEBUG builds of the watch app poll the dev
server every 2s and hot-restart the QuickJS runtime when the bundle
changes — edit `demo/App.tsx` and the simulator updates without an
Xcode rebuild.

The qjs smoke test needs a `qjs` binary on PATH (`apt install quickjs` /
`brew install quickjs`). `tools/embed-smoke/run.sh` additionally compiles
the vendored quickjs-ng sources with a C host and runs the bundle through
the same embedding calls `JSRuntime.swift` makes. Both are also the local
crash-repro loop — see [debugging.md](./debugging.md#the-local-repro-loop-no-watch-required).

## Watch app — requires macOS 15+, Xcode 16+

```bash
pnpm install                              # workspace install (every member)
pnpm --filter react-watchos build  # produce the JS bundle
# set your team id in app/app.json ("appleTeamId")
cd app && npx expo prebuild -p ios --clean  # generates ios/ with the watch target
xed ios                                   # open the workspace
```

In Xcode: select the **React Watch** scheme, choose a paired watch
simulator (or device), and run. Edit `js/demo/App.tsx`, re-run
`npm run build`, and rebuild the watch target to see changes. To see the
complications, add the Hydration complication to a watch face (or the
widget to the Smart Stack), then tap "Add glass" in the app — the gauge
updates via `publishWidgets()`.

For running the demo on the simulator without hand-rolling `xcodebuild` — and
for the App-Group signing trap that makes shared state silently read `0` —
use [running-on-sim.md](./running-on-sim.md).

**First-build friction (verified on the watchOS simulator; the physical-device
pass is scoped in [status.md](./status.md) — Rule 12):**

- The watch target depends on the `js/swift/` SwiftPM package. The unified
  `react-watchos` config plugin (its `app.plugin.js` entry) writes the
  SwiftPM references into the generated watch/widget targets **during**
  `expo prebuild` — via a base mod that runs after apple-targets has created the
  targets (apple-targets/node-xcode have no local-package API, so it edits the
  pbxproj directly). There is no separate post-prebuild step, and a genuine link
  failure now fails the prebuild loudly rather than being swallowed. If it didn't
  apply, add it in Xcode (File ▸ Add Package Dependencies ▸ Add Local ▸
  `js/swift/`) and link **ReactWatchHost** to the watch target, **ReactWatchWidget**
  + **ReactWatchCore** to the widget (ReactWatchWidget pulls in
  Support/Runtime transitively). The engine is a Clang module
  (`import CQuickJS`) — no bridging header.
- Confirm `assets/bundle.js` landed in the watch target's bundle resources.
- `WKRunsIndependentlyOfCompanionApp` (standalone watch app) is set by the
  plugin by default (`independent` option) and applied by the same in-prebuild
  Info.plist merge — for a companion-dependent watch app pass `independent:
  false`. ⚠️ Independence is irreversible after your first App Store upload, so
  choose before submitting (see [publishing.md](./publishing.md)).
- App Groups: both the watch and widget targets must have the
  `group.com.emindeniz99.reactwatch` App Group capability (declared in
  their `expo-target.config.js`; verify under Signing & Capabilities, and
  register the group id for your team).
  ⚠️ **Registering the group id is a one-time MANUAL step on the plain
  `xcodebuild` path.** `-allowProvisioningUpdates` creates App IDs and
  provisioning profiles for you, but it does NOT create App Group
  identifiers — do that once in Xcode's Signing & Capabilities pane or in
  the developer portal, or the device build signs without the group and
  every shared-state screen silently reads 0 (the device twin of the
  simulator trap in [running-on-sim.md](./running-on-sim.md)). EAS Build
  creates the group for you; local `xcodebuild` does not. Verified on a
  real Ultra 3, 2026-08-11 (adagia session): once registered, the
  entitlement survives device signing — `codesign -d --entitlements :-`
  shows the group on both the app and the appex.
