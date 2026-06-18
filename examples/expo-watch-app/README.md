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

## Building the actual watch app (macOS 15+, Xcode 16+)

```bash
pnpm --filter expo-watch-app build:watch   # build the watch JS bundle
pnpm --filter expo-watch-app prebuild      # expo prebuild -p ios --clean
# open ios/, select the watch scheme, run on a watchOS simulator
```

### The Swift host (one manual step — see note)

`react-native-watchos` ships the **JS engine + UI**, not yet a reusable Swift
host package. The watch target needs the native runtime that embeds QuickJS and
interprets the tree. Until a SwiftPM host package exists, copy it from the
reference app in this repo into `targets/watch/`:

- `JSRuntime.swift`, `WatchApp.swift`, `NodeView.swift` (and the bridges you
  use: `PhoneConnectivity.swift`, `BluetoothBridge.swift`, `SensorBridge.swift`)
- `Vendor/quickjs/` (the vendored quickjs-ng C sources)
- `Generated/WireModel.swift` (the codegen'd wire models)
- the bridging-header config plugin (`plugins/with-quickjs-bridging.js`)

all from `projects/react-native-watchos/app/`. Then add the App Group /
usage-description keys for whatever native capabilities your watch UI calls
(see the renderer README and `docs/extending.md`).

> Packaging that Swift host as a SwiftPM dependency is the next packaging step
> — it would turn this manual copy into one `Package.swift` line. Tracked in
> the renderer roadmap.

See [`../minimal-watch-app`](../minimal-watch-app) for the smallest possible
consumer (watch UI only, no iPhone app).
