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

### The Swift host (a SwiftPM package)

The native runtime — the QuickJS engine, the `NodeView` interpreter, the
bridges — is the **`swift/` SwiftPM package** in this repo. Your watch target
depends on it and writes ~10 lines:

```swift
import ReactWatchHost
import SwiftUI

@main
struct MyWatchApp: App {
    var body: some Scene {
        WindowGroup {
            ReactWatchRootView(appGroupId: "group.com.example.expowatch")
        }
    }
}
```

Linking the package happens in the config plugin
(`app/plugins/with-react-watch-package.js` in the reference app — copy it
here): during `expo prebuild` it writes the SwiftPM references into the
generated watch + widget targets. If it didn't apply (it's wrapped so it can
never fail prebuild), add it by hand in Xcode:

> File ▸ Add Package Dependencies… ▸ Add Local… ▸ select
> `projects/react-native-watchos/js/swift`, then add **ReactWatchHost** to the
> watch target (and **ReactWatchCore** + **ReactWatchRuntime** to the widget
> target if you ship complications).

Then add the App Group / usage-description keys for whatever native
capabilities your watch UI calls (see the renderer README and
`docs/extending.md`). The Linux CI builds the package's engine/core/runtime;
the SwiftUI host and this Xcode wiring are the macOS gate.

See [`../minimal-watch-app`](../minimal-watch-app) for the smallest possible
consumer (watch UI only, no iPhone app).
