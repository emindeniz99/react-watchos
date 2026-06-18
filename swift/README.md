# ReactWatchHost (SwiftPM)

The native host for [`react-native-watchos`](../README.md): the QuickJS engine,
the runtime that embeds it, the generated wire models, and the SwiftUI
interpreter that renders committed React trees. A consumer's watch target
depends on this package instead of copying the host into their app.

## Products

| Product | Imports | Builds on Linux? |
|---|---|---|
| `CQuickJS` | quickjs-ng v0.10.1 as a Clang module (`import CQuickJS`) | ✅ |
| `ReactWatchCore` | the codegen'd wire models (`RNNode`, `RNTree`, `RNWire`, `JSONValue`, `Published*`) — Foundation only | ✅ |
| `ReactWatchRuntime` | the QuickJS embedding (`JSRuntime`) — Foundation + `CQuickJS` | ✅ |
| `ReactWatchHost` | the SwiftUI interpreter, native bridges, and `public ReactWatchRootView(appGroupId:)` | ❌ (Xcode) |

The first three are Foundation/C only, so CI `swift build`s them on Linux and
the wire-contract tests decode fixtures through `ReactWatchCore`. `ReactWatchHost`
pulls in SwiftUI / WatchKit / CoreBluetooth / HealthKit, so it's the macOS gate.

## Use it

```swift
import ReactWatchHost
import SwiftUI

@main
struct MyWatchApp: App {
    var body: some Scene {
        WindowGroup {
            // Ship your JS as the target's bundle.js resource; appGroupId
            // (optional) enables shared widget/Storage state.
            ReactWatchRootView(appGroupId: "group.com.example.app")
        }
    }
}
```

In an Expo app the `@bacons/apple-targets` watch target links this package via
the `with-react-watch-package` config plugin during `expo prebuild` (or add it
once in Xcode: Add Package Dependencies ▸ Add Local ▸ this folder). The wire
models are generated from `js/codegen/schema.mjs` — run `npm run codegen`; never
edit `Sources/ReactWatchCore/WireModel.swift` by hand.

## Notes

- Built in Swift 6 language mode. `-warnings-as-errors` is applied to the
  contract tests; making `JSRuntime` Linux-buildable already caught real bugs
  (`JS_IsException` returns `Bool` in quickjs-ng).
- `path:`-referenced today; publishing it (remote SPM) so consumers get a
  versioned dependency is the next packaging step (see the roadmap).
