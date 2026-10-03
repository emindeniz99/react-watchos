# Decision: deployment floor watchOS 26 / iOS 26

**Status:** decided (owner, 2026-10-03). Ships in 0.11.0. Consumer steps are in
[MIGRATIONS.md](../MIGRATIONS.md) under `0.10.x → 0.11.0`.

## Why the floor was 10

Nobody chose it. watchOS 10 came with the Expo / apple-targets watch template
in the first demo commit, was copied into `Package.swift`, and the docs then
treated it as given. Every `@available` gate below 26 in the package existed
only to honour that inherited number.

## Why 26

- **Devices.** The only watches a watchOS 10 floor keeps are Series 4,
  Series 5 and SE (1st gen), sold 2018–2020. Their last release is watchOS 10
  and Apple ended support for them in September 2024.
- **No reason to stop at 11.** No model stops at watchOS 11, so watchOS 11 and
  watchOS 26 run on the same devices. A floor of 11 would remove the 10 gates
  and keep the 26 gates for no audience.
- **Toolchain.** Building already requires Xcode 26 and the watchOS 26 SDK
  (`.glass`, `.glassEffect()`, `RelevantContext.DateKind`). The runtime floor
  now matches the toolchain floor.
- **Not the newest.** watchOS 26 shipped 2025-09-15 and watchOS 27 shipped
  2026-09-14, so 26 is one major behind current.
- **No share data.** Apple publishes no watchOS adoption numbers, so the
  decision rests on the device list, not on a usage percentage.
- **iOS.** Raising iOS 17 to 26 drops only iPhone XS, XS Max and XR (2018;
  Apple support ended 2026-04-22). In this package the iOS floor is only a
  `Package.swift` declaration: every source is `#if os(watchOS)`, and nothing
  else sets an iOS target.

Sources, checked 2026-10-03:
[endoflife.date/apple-watch](https://endoflife.date/apple-watch),
[endoflife.date/watchos](https://endoflife.date/watchos),
[endoflife.date/iphone](https://endoflife.date/iphone).

## What changed

- `js/swift/Package.swift`: `platforms: [.watchOS("26.0"), .iOS("26.0"),
  .macOS(.v14)]`. The string form keeps `swift-tools-version:6.0`; the `.v26`
  enum cases need tools 6.2, which the Linux `swift:6.0` CI container lacks.
- Config plugin default `deploymentTarget`: `"10.0"` → `"26.0"`
  (`js/plugin/index.cts`), plus the demo `app/app.json` and
  `examples/expo-watch-app/app.json` (which pinned `"11.0"`).
- Availability gates removed, fallback branches deleted:
  - `ReactWatchHost/NodeView.swift`: double-tap `handGestureShortcut`
    (was 11.0), `.glass` / `.glassProminent` button styles and `glassEffect()`
    (were 26.0).
  - `ReactWatchWidget/ReactWidgetButtonIntent.swift` and
    `ReactWidgetView.swift`: interactive widget buttons (were 11.0).
  - `ReactWatchWidget/ReactTimeline.swift`: `reactRelevantContext` and
    `relevance()` (were 11.0); the `date` + `dateKind`, `dateRange` and `poi`
    arms and their helpers (were 26.0, returned nil below).
  - `app/targets/widget/`: the demo's Controls and the shopping widget's
    `relevance()`.
- Behaviour on watchOS 26 and later is unchanged; only the below-floor paths
  are gone.

## What did not change

- The `watchOS 27` gates in `ReactWatchHost.swift` (Foundation Models, inside
  `#if canImport(FoundationModels)`). 27 is above the floor.
- The macOS floor (`.macOS(.v14)`), which exists for `swift build` / `swift
  test` on a Mac.
- No new API. Symbols that were cut only because they sat above the old floor
  (`WorkoutStep.displayName`, `poolSwimDistanceWithTime`, the power alert
  `metric`, `HKActivitySummary.isPaused`, the watchOS 11 distance types) are
  now reachable and listed as follow-up work in [roadmap.md](./roadmap.md).

## Revisit

When watchOS 28 ships, consider moving the floor to 27 the same way: check
which devices stop at 26, and whether the toolchain already requires the 27
SDK.
