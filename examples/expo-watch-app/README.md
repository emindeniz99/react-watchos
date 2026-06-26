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

The plugin generates `targets/watch/expo-target.config.js` and pre-registers the
SwiftPM reference during prebuild. The one piece it can't generate — the watch
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
pnpm --filter expo-watch-app prebuild   # build the watch bundle, then
                                        # `react-native-watchos prebuild`
# open ios/, select the watch scheme, run on a watchOS simulator
```

`react-native-watchos prebuild` runs `expo prebuild` and then, in one command,
links the **ReactWatchHost** SwiftPM product into the watch target and merges
the target's `Info.plist` (the standalone flag + any usage strings) — no
hand-wired `postprebuild`, no manual "Add Package Dependencies…" in Xcode. The
native runtime (the QuickJS engine, the `NodeView` interpreter, the bridges) is
the `swift/` SwiftPM package; the plugin does the linking. Add App Group /
usage-description keys for the native capabilities your watch UI calls via the
plugin's `infoPlist` option (see the renderer README and `docs/extending.md`).
The Linux CI builds the package's engine/core/runtime; the SwiftUI host + this
Xcode wiring are the macOS gate.

See [`../minimal-watch-app`](../minimal-watch-app) for the smallest possible
consumer (watch UI only, no iPhone app).
