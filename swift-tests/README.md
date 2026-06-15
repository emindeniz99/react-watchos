# swift-tests — Linux wire-contract checks

Verifies the JS↔Swift wire schema in **real Swift on Linux**, without a Mac.
Each executable compiles the *actual* Foundation-only model file from the
app (symlinked, so it can't drift) and decodes a fixture produced by the
real JS serializer:

| Target | Compiles | Decodes | Fixture from |
|---|---|---|---|
| `CommitContract` | `app/targets/watch/NodeModel.swift` | a commit tree incl. `TimerText` | `js/test/contract-fixture.test.tsx` |
| `WidgetContract` | `app/targets/widget/WidgetModels.swift` | a `publishWidgets` payload | same |

The SwiftUI / WidgetKit / WatchKit layers can't compile on Linux (those
frameworks are macOS-only) — that's what the macOS CI workflow
(`.github/workflows/react-native-watchos-build.yml`) covers.

## Run

```bash
# 1. (re)generate the fixtures from the real serializer
cd ../js && npx vitest run contract-fixture
# 2. compile the real models + decode (needs a Swift 6 toolchain on PATH)
cd ../swift-tests && swift run CommitContract && swift run WidgetContract
```

Install a Linux Swift toolchain from https://www.swift.org/install/linux/
(or `swiftly`). The fixtures under `Fixtures/` are committed so the Swift
side runs standalone.
