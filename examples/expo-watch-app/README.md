# expo-watch-app

An **Expo / React Native iPhone app that adds a watch feature** powered by
`react-native-watchos`. This is the realistic adoption shape: you have (or
start) a normal Expo app, and bolt on a watch target whose UI is React running
on the watch.

Two halves:

- **iPhone app** (`App.tsx`, `index.js`, `app.json`) — ordinary Expo/RN. Uses
  `react-native-watch-connectivity` to talk to the watch.
- **Watch UI** (`watch-ui/`) — React on the `react-native-watchos` engine,
  bundled by [`scripts/build-watch.mjs`](./scripts/build-watch.mjs) (the shared
  build preset) into the watch target's `assets/bundle.js`.

## What's verifiable on Linux (and in CI)

The watch UI is pure JS, so it's fully checkable without a Mac:

```bash
pnpm --filter expo-watch-app typecheck    # watch-ui + build script + test
pnpm --filter expo-watch-app test         # runApp + MemoryHost + /testing
pnpm --filter expo-watch-app build:watch  # -> targets/watch/assets/bundle.js
```

It consumes the renderer through the pnpm workspace (`"react-native-watchos":
"workspace:*"`), so there is a single React instance and no alias / nodePaths /
tsconfig-paths glue.

## How the watch target is wired (the config plugin)

This example **dogfoods the package's own config plugin** — `app.json` lists
`react-native-watchos` (not `@bacons/apple-targets` directly), and that's the
whole integration:

```jsonc
// app.json
"plugins": [["react-native-watchos", { "name": "Expo Watch", "widget": false }]]
```

During `expo prebuild` the plugin generates `targets/watch/expo-target.config.js`,
**links the `ReactWatchHost` SwiftPM product into the watch target, and merges
the target `Info.plist`** — automatically, no `postprebuild` and no manual "Add
Package Dependencies…" in Xcode. The one piece it can't generate — the watch
app's `@main` Swift entry — is scaffolded for you:

```bash
npx react-native-watchos scaffold   # -> targets/watch/WatchApp.swift
```

`WatchApp.swift` is just a thin consumer of the package (embeds
`ReactWatchRootView` with your App Group); it's the only committed Swift file —
the generated `expo-target.config.js` / `Info.plist` / entitlements are not
committed (see `.gitignore`).

## Building the actual watch app (macOS 15+, Xcode 16+)

```bash
pnpm --filter expo-watch-app prebuild   # build the watch bundle, then `expo prebuild`
# open ios/, select the watch scheme, run on a watchOS simulator
```

`prebuild` builds the watch JS bundle and runs `expo prebuild` — plain Expo; the
`react-native-watchos` plugin does the SwiftPM link + the `Info.plist` merge as
part of prebuild itself (it hooks apple-targets' own xcode mod). The native
runtime (the QuickJS engine, the `NodeView` interpreter, the bridges) is the
`swift/` SwiftPM package. Add App Group / usage-description keys for the native
capabilities your watch UI calls via the plugin's `infoPlist` option (see the
renderer README and `docs/extending.md`). The Linux CI builds the package's
engine/core/runtime; the SwiftUI host + this Xcode wiring are the macOS gate.

## Over-the-air updates (the "Check for update" button)

The watch UI ships a **Check for update** button (`watch-ui/App.tsx`) that
fetches a manifest and stages a fresher JS bundle without a rebuild/resubmit.
OTA in production is just static hosting — there's no server to deploy. The
moving parts:

1. **`build:watch` stamps the manifest.** [`scripts/build-watch.mjs`](./scripts/build-watch.mjs)
   calls `writeOTAManifest` (from `react-native-watchos/manifest`), which writes
   `targets/watch/assets/manifest.json` next to the bundle — the manifest's
   `releaseId` is the bundle's content hash, so a changed bundle is detectable.
   It also declares this UI's capability contract
   (`requiredFeatures: ["connectivity", "network", "ota"]`).
2. **`REACT_WATCH_OTA_URL` is baked into the bundle at build time** — the URL the
   button fetches `/manifest.json` from. Empty (button shows a hint) unless set.
3. **Serve the assets.** [`scripts/serve-ota.mjs`](./scripts/serve-ota.mjs)
   (`pnpm ota:serve`) statically serves `targets/watch/assets/`; in production
   use any CDN/S3 instead.

Demo flow on the simulator (the watch sim shares the Mac's network, so
`127.0.0.1` works):

```bash
REACT_WATCH_OTA_URL=http://127.0.0.1:8788 pnpm build:watch  # bake URL + stamp manifest
pnpm prebuild                                               # build the app, run it on the sim
pnpm ota:serve                                              # terminal A: serve the assets
# edit watch-ui/App.tsx, then re-stamp the served bundle:
REACT_WATCH_OTA_URL=http://127.0.0.1:8788 pnpm build:watch  # new releaseId
# tap "Check for update" on the watch → "staged v1 — relaunch"
```

Sign manifests for production with the renderer's `ota:sign` (the private
`OTA_SIGNING_KEY` is yours and is never committed); see the renderer README's
OTA section.

See [`../minimal-watch-app`](../minimal-watch-app) for the smallest possible
consumer (watch UI only, no iPhone app).
