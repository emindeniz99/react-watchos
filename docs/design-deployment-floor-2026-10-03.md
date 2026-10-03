# Decision: deployment floor watchOS 26 / iOS 26

**Status:** reverted 2026-10-03, floor is watchOS 10. PR #31 raised the floor
to watchOS 26 / iOS 26; it was reverted the same day, before any release
carried it (npm was still at 0.10.0), so no consumer has anything to undo.

## Reverted

Owner decision, 2026-10-03. `Package.swift` is back to
`.watchOS(.v10), .iOS(.v17), .macOS(.v14)`, the config plugin's default
`deploymentTarget` is `"10.0"` again, and every watchOS 11 and 26
availability gate PR #31 removed is back with its fallback. The 0.11.0
entry in MIGRATIONS.md and the roadmap list of symbols "reachable at the 26
floor" went with the revert. Both example apps now say `"10.0"`; the Expo
example's earlier `"11.0"` was not restored.

Why watchOS 10:

- **It drops no watch Apple still updates.** Series 4, Series 5 and SE (1st
  gen) stop at watchOS 10. watchOS 9 runs on the same hardware, so going
  lower gains no device.
- **Those watches are not a rounding error.** They are an estimated 4–7% of
  active Apple Watches. The figure is a shipment-based estimate (annual units
  times a survival curve); Apple publishes no data, and the estimate moves by
  5–8 points across survival assumptions. The original record below said no
  share data existed; this estimate is what filled that gap.
- **Same rule as the consumer app.** The iPhone app that ships this package
  sits at iOS 16.4, the Expo SDK 57 default, chosen the same way: the widest
  floor that keeps every device Apple can still update.
- **The toolchain does not force 26.** Building needs a current SDK, but the
  deployment target is a separate setting. The owner builds with Xcode 27,
  which still targets watchOS 9 and later; watchOS 10 is the lowest it can
  simulate or debug. So a watchOS 10 floor can still be built, run on a
  simulator and debugged. Apple lists both sets of numbers on its
  [Xcode support page](https://developer.apple.com/support/xcode/); the
  release notes separate the deployment floor from the simulator floor.

Evidence, with the device tables and the share estimate:
[2026-10-03-apple-os-floors.md](https://github.com/emindeniz99/playground/blob/main/projects/stack/docs/evidence/2026-10-03-apple-os-floors.md).

**Props added after PR #31.** PRs #32 and #36 were written against the 26
floor, so each SwiftUI API they call was checked against Apple's docs JSON
on 2026-10-03 (watchOS `introducedAt`):

| API | watchOS |
|---|---|
| `View.fontDesign(_:)` | 9.1 |
| `Text.fontDesign(_:)` | 9.1 |
| `View.containerBackground(_:for:)` | 10.0 |
| `ContainerBackgroundPlacement.tabView` | 10.0 |
| `View.accessibilityHidden(_:)` | 7.0 |
| `AnyShapeStyle` | 8.0 |

All are at or below 10.0, so `fontDesign`, the gradient `background`,
`containerBackground` and `accessibilityHidden` need no new gate.

**How the floor is checked.** The `watchos-floor-build` job in
`.github/workflows/build.yml` installs a watchOS 10.5 simulator runtime,
asserts that the scheme's targets declare 10.0, builds the "React Watch"
scheme (host and widget) for that simulator and runs the package tests on
it. If CI cannot install the runtime, the same run is owed on a Mac once per
release (see [mac-session-checklist.md](./mac-session-checklist.md)). A floor
nothing runs on is a claim, not a supported floor.

**Revisit trigger.** Raise the floor only when the Xcode this project
requires can no longer target watchOS 10, or when the share of Series 4,
Series 5 and SE (1st gen) is measured under about 3%. This replaces the
"Revisit" rule at the end of the original record.

## Original decision: watchOS 26 (superseded)

Kept as written on 2026-10-03, as the record of what was tried and why. Its
status line read: "decided (owner, 2026-10-03). Ships in 0.11.0." "What
changed" describes the tree PR #31 produced, which no longer exists.

### Why the floor was 10

Nobody chose it. watchOS 10 came with the Expo / apple-targets watch template
in the first demo commit, was copied into `Package.swift`, and the docs then
treated it as given. Every `@available` gate below 26 in the package existed
only to honour that inherited number.

### Why 26

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

### What changed

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

### What did not change

- The `watchOS 27` gates in `ReactWatchHost.swift` (Foundation Models, inside
  `#if canImport(FoundationModels)`). 27 is above the floor.
- The macOS floor (`.macOS(.v14)`), which exists for `swift build` / `swift
  test` on a Mac.
- No new API. Symbols that were cut only because they sat above the old floor
  (`WorkoutStep.displayName`, `poolSwimDistanceWithTime`, the power alert
  `metric`, `HKActivitySummary.isPaused`, the watchOS 11 distance types) are
  now reachable and listed as follow-up work in [roadmap.md](./roadmap.md).

### Revisit

When watchOS 28 ships, consider moving the floor to 27 the same way: check
which devices stop at 26, and whether the toolchain already requires the 27
SDK.
