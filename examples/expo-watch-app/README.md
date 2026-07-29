# expo-watch-app

An **Expo / React Native iPhone app that adds a watch feature** powered by
`react-watchos`. This is the realistic adoption shape: you have (or
start) a normal Expo app, and bolt on a watch target whose UI is React running
on the watch.

Three halves:

- **iPhone app** (`App.tsx`, `index.js`, `app.json`) — ordinary Expo/RN. Uses
  `react-native-watch-connectivity` to talk to the watch.
- **Watch UI** (`watch-ui/App.tsx` → `watch-ui/entry.tsx`) — React on the
  `react-watchos` engine, bundled into the watch target's
  `assets/bundle.js`.
- **Widgets** (`watch-ui/widgets.tsx`) — two React-rendered complications (a
  static one and a live-data one), a second bundle the watch widget extension
  evaluates. See [Widget](#widget-a-react-complication).

Both bundles are built by one script,
[`scripts/build-targets.mjs`](./scripts/build-targets.mjs), which calls the
package's `buildBundles` helper (the shared preset) — so there's no per-target
esbuild boilerplate, just the entry/outfile that differ.

## What's verifiable on Linux (and in CI)

The watch UI is pure JS, so it's fully checkable without a Mac:

```bash
pnpm --filter expo-watch-app typecheck     # watch-ui + build script + test
pnpm --filter expo-watch-app test          # runApp + MemoryHost + /testing
pnpm --filter expo-watch-app build:targets # -> watch + widget bundles
```

It consumes the renderer through the pnpm workspace (`"react-watchos":
"workspace:*"`), so there is a single React instance and no alias / nodePaths /
tsconfig-paths glue.

## How the watch target is wired (the config plugin)

This example **dogfoods the package's own config plugin** — `app.json` lists
`react-watchos` (not `@bacons/apple-targets` directly), and that's the
whole integration:

```jsonc
// app.json
"plugins": [["react-watchos", { "name": "Expo Watch", "widget": true }]]
```

During `expo prebuild` the plugin generates each target's
`expo-target.config.js`, **links the SwiftPM products** (the watch target →
`ReactWatchHost`; the widget target → `ReactWatchWidget` + `ReactWatchCore`)
**and merges the target `Info.plist`s** — automatically, no `postprebuild` and
no manual "Add Package Dependencies…" in Xcode. The pieces it can't generate —
each target's `@main` Swift entry — are scaffolded for you:

```bash
npx react-watchos scaffold   # -> targets/watch/WatchApp.swift
                                     #    targets/widget/ReactWidgets.swift
```

`WatchApp.swift` (embeds `ReactWatchRootView`) and `ReactWidgets.swift` (a
`@main WidgetBundle` whose widgets render through `ReactTimelineProvider` +
`reactWidgetView`) are thin consumers of the package — the only committed Swift
files. The generated `expo-target.config.js` / `Info.plist` / entitlements are
not committed (see `.gitignore`).

## Building the actual watch app (macOS 15+, Xcode 16+)

```bash
pnpm --filter expo-watch-app prebuild   # build the watch bundle, then `expo prebuild`
# open ios/, select the watch scheme, run on a watchOS simulator
```

`prebuild` builds both JS bundles (watch + widget) and runs `expo prebuild` —
plain Expo; the `react-watchos` plugin does the SwiftPM link + the
`Info.plist` merge as part of prebuild itself (it hooks apple-targets' own xcode
mod). The native runtime (the QuickJS engine, the `NodeView` interpreter, the
bridges) is the `swift/` SwiftPM package. Add App Group / usage-description keys
for the native capabilities your watch UI calls via the plugin's `infoPlist`
option (see the renderer README and `docs/extending.md`). The Linux CI builds
the package's engine/core/runtime; the SwiftUI host + this Xcode wiring are the
macOS gate.

## Widget (a React complication)

This example enables the widget target (`"widget": true` above), so it shows the
full widget path a consumer writes — which is small, because the WidgetKit
machinery lives in the `ReactWatchWidget` package:

- **JS** — [`watch-ui/widgets.tsx`](./watch-ui/widgets.tsx) calls `registerWidget`
  and renders React trees. It's registered by *both* bundles (the widget
  extension renders on demand; the app publishes too) — [`watch-ui/widget.entry.tsx`](./watch-ui/widget.entry.tsx)
  is just `import "./widgets"` (no `runApp`, so the extension stays small).
  Built by `build:targets` → `targets/widget/assets/bundle.js`.
- **Swift** — `npx react-watchos scaffold` generated
  [`targets/widget/ReactWidgets.swift`](./targets/widget/ReactWidgets.swift): a
  `@main WidgetBundle` whose widgets render through the package's
  `ReactTimelineProvider` + `reactWidgetView`. That's the whole Swift side — no
  interpreter, no timeline plumbing, no per-widget QuickJS code.

### Static vs. live-data vs. interactive widgets

The example registers two widgets to show the spectrum — and note the **Swift is
identical for all**; "live data" and "interactive" are purely JS concerns:

- **`example` (static)** — its `render` reads nothing external, so the widget
  extension renders constant content on its own. No running app required.
- **`taps` (live data + interactive)** — its `render` reads the count from a
  cross-process-atomic counter (`Storage.counterValue("taps")`). The watch app
  bumps it (`App.tsx`'s "Tap +1" → `Storage.counterAdd` + `publishWidgets()`),
  **and** on the rectangular family the complication shows live **+/- buttons**
  (`<Button intent="taps.inc/dec">`) that run `registerIntent` handlers in the
  extension with no app launch (watchOS 11+). Both sides mutate the same key in
  different processes, so it's an **atomic counter** (ARCH-05) — `counterAdd`
  avoids the lost-update race that `Storage.set` would have.

`expo prebuild` links `ReactWatchWidget` + `ReactWatchCore` into the widget
target automatically (the prebuild log prints the linked products). For a
*configurable* widget (a picker on the watch face) write your own
`AppIntentTimelineProvider` on the package's `reactTimeline`/`reactSnapshotEntry`
helpers — see the demo (`app/targets/widget`).

## Over-the-air updates (the "Check for update" button)

The watch UI ships a **Check for update** button (`watch-ui/App.tsx`) that
fetches a manifest and stages a fresher JS bundle without a rebuild/resubmit.
OTA in production is just static hosting — there's no server to deploy. The
moving parts:

1. **`build:targets` stamps the manifest.** [`scripts/build-targets.mjs`](./scripts/build-targets.mjs)
   passes a `manifest` for the watch target, so `buildBundles` calls
   `writeOTAManifest` and writes `targets/watch/assets/manifest.json` next to the
   bundle — the manifest's `releaseId` is the bundle's content hash, so a changed
   bundle is detectable. It also declares this UI's capability contract
   (`requiredFeatures: ["connectivity", "network", "ota"]`). The widget target
   has no `manifest` (it's shipped, not OTA'd).
2. **`REACT_WATCH_OTA_URL` is baked into the bundle at build time** — the URL the
   button fetches `/manifest.json` from. Empty (button shows a hint) unless set.
3. **Serve the assets.** [`scripts/serve-ota.mjs`](./scripts/serve-ota.mjs)
   (`pnpm ota:serve`) statically serves `targets/watch/assets/`; in production
   use any CDN/S3 instead.

Demo flow on the simulator (the watch sim shares the Mac's network, so
`127.0.0.1` works):

```bash
REACT_WATCH_OTA_URL=http://127.0.0.1:8788 pnpm build:targets  # bake URL + stamp manifest
pnpm prebuild                                               # build the app, run it on the sim
pnpm ota:serve                                              # terminal A: serve the assets
# edit watch-ui/App.tsx, then re-stamp the served bundle:
REACT_WATCH_OTA_URL=http://127.0.0.1:8788 pnpm build:targets  # new releaseId
# tap "Check for update" on the watch → "staged v1 — relaunch"
```

Sign manifests for production with the renderer's `ota:sign` (the private
`OTA_SIGNING_KEY` is yours and is never committed); see
[`docs/ota-signing.md`](../../docs/ota-signing.md).

See [`../minimal-watch-app`](../minimal-watch-app) for the smallest possible
consumer (watch UI only, no iPhone app).
