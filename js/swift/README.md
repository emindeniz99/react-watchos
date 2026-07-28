# ReactWatchHost (SwiftPM)

The native host for [`react-watchos`](../README.md): the QuickJS engine,
the runtime that embeds it, the generated wire models, and the SwiftUI
interpreter that renders committed React trees. A consumer's watch target
depends on this package instead of copying the host into their app.

## Products

| Product | Imports | Builds on Linux? |
|---|---|---|
| `CQuickJS` | quickjs-ng v0.15.1 as a Clang module (`import CQuickJS`) | ✅ |
| `ReactWatchCore` | the codegen'd wire models (`RNNode`, `RNTree`, `RNWire`, `JSONValue`, `Published*`) — Foundation only, `Sendable` | ✅ |
| `ReactWatchSupport` | Foundation-only platform logic: `SharedWidgetStore`, `OptimisticStore`, `NotificationPlan`, `FetchPlan`/`FetchResponse` (extracted from the host so it's unit-tested) | ✅ |
| `ReactWatchRuntime` | the QuickJS embedding (`JSRuntime`) — Foundation + `CQuickJS` | ✅ |
| `ReactWatchHost` | the SwiftUI interpreter, native bridges, and `public ReactWatchRootView(appGroupId:)` | ❌ (Xcode) |
| `ReactWatchWidget` | the WidgetKit infra: the React node interpreter (`WidgetNodeView` / `reactWidgetView`), the timeline providers (`ReactTimelineProvider`, `reactTimeline`/`reactSnapshotEntry`), the relevance/control helpers, and the extension's QuickJS runtime (`WidgetIntentRuntime`) — all `appGroupId`-threaded | ❌ (Xcode) |

Everything except `ReactWatchHost` / `ReactWatchWidget` is Foundation/C only, so
CI `swift build`s the package and `swift test` runs the wire-contract +
support-logic + QuickJS-engine tests on Linux. `ReactWatchHost` (SwiftUI /
WatchKit / CoreBluetooth / HealthKit) and `ReactWatchWidget` (WidgetKit /
AppIntents / RelevanceKit) are the macOS gate — the manifest drops them on a
non-Apple build host, and each source is `#if os(watchOS)` so it compiles to an
empty module off-watchOS while `xcodebuild` builds the real code for the watch.

`swift test` only runs on the host; to run the same tests **inside the watchOS
simulator** (proving the engine + wire models on the real watch architecture),
use xcodebuild — this is what the on-demand macOS workflow does:

```bash
xcodebuild test -scheme ReactWatchHost-Package \
  -destination 'platform=watchOS Simulator,name=Apple Watch Series 11 (46mm)'
```

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
models are generated from `js/codegen/schema.ts` — run `npm run codegen`; never
edit `Sources/ReactWatchCore/WireModel.swift` by hand.

## Breaking changes

Pre-release, this package breaks freely (project rule 1: no shims, no
compat overloads). Breaks in `public` API of a shipped product are recorded
here, because the Swift API ships inside the npm package (`files` includes
`swift/Package.swift`, `swift/Sources`, `swift/Tests`) and the JS changelog
does not otherwise describe it.

- **`reactControlMetadata` returns a 3-tuple.**
  `reactControlMetadata(_:appGroupId:)` and `reactControlMetadata(_:in:)` now
  return `(label: String, systemName: String?, actionLabel: String?)?` instead
  of `(label: String, systemName: String?)?`. A consumer destructuring the pair
  — `if let (label, symbol) = reactControlMetadata(…)` — or annotating the
  2-tuple no longer compiles. Read `.actionLabel`, or widen the pattern to
  three elements.

## Notes

- Built in Swift 6 language mode. `-warnings-as-errors` is applied to the
  contract tests; making `JSRuntime` Linux-buildable already caught real bugs
  (`JS_IsException` returns `Bool` in quickjs-ng).
- `path:`-referenced today; publishing it (remote SPM) so consumers get a
  versioned dependency is the next packaging step (see the roadmap).
