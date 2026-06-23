# Fatbobman's Swift Weekly #135 — notes

- **Source:** Fatbobman's Swift Weekly, Issue #135 (2026-05-11)
- **Link:** <https://fatbobman.com/en/weekly/issue-135/>
- **Captured:** 2026-06-23
- **Why it matters here:** SPM-vs-CocoaPods direction (we're SPM + Expo
  prebuild), plus concrete SwiftUI / Swift 6 / background-refresh tips relevant
  to the watch host.

## Editorial: CocoaPods out, SwiftPM "chapter two"

- Flutter 3.44 makes **SwiftPM the default** iOS/macOS dependency manager;
  **CocoaPods Trunk goes read-only 2026-12-02.**
- Cross-platform frameworks (React Native, KMP, Unity) are migrating to SPM.
- Framing: SPM's win is *inward* (within Apple's ecosystem), not vs Cargo/npm;
  its next decade hinges on Swift on Linux/Android/embedded.
- **For us:** our app still uses CocoaPods via Expo prebuild (`app/ios/Podfile`,
  `Pods/`), while our own host is a local SwiftPM package. Worth watching
  whether the Expo/RN toolchain moves the app off CocoaPods — a future cleanup,
  not urgent.

## Articles worth remembering

- **WatchConnectivity was failing 40% of the time** — Tarek Sabry. Captured
  separately in [watchconnectivity-reliability.md](watchconnectivity-reliability.md)
  (directly relevant to our phone↔watch path).
- **Deep understanding while using LLMs** — Chris Eidhof. Fast LLM answers ≠
  understanding; LLMs amplify judgment, don't replace it. (Matches this repo's
  CLAUDE.md "think before coding / surface tradeoffs" rules.)
- **Installing Swift scripts as global commands with npm** — Cristian Felipe
  Patiño Rojas. Register Swift scripts as global commands via npm `bin` +
  shebang; good for dev, but Swift cold-start favors compiled binaries for
  distribution. (We already use Node `.cjs` post-prebuild scripts; same idea.)
- **Using SwiftUI to build a Mac-assed app in 2026** — Paulo Andrade. SwiftUI
  still lacks AppKit parity (list selection nuances, context-menu detection,
  drag state, TextField keyboard swallowing, toolbar precision). Reminder that
  SwiftUI gaps are real — relevant since we re-render SwiftUI from JS.
- **Scheduling/handling background app refresh in SwiftUI** — Natalia Panferova.
  `BGAppRefreshTaskRequest` via Background Tasks + `backgroundTask(_:action:)`
  scene modifier. **"Background refresh is not a precise scheduler"** — the
  system decides if/when to wake, even with `earliestBeginDate`. Relevant if we
  ever refresh complications/data in the background (today widgets use
  `reloadAfter` + WidgetCenter, not BG tasks).
- **How to avoid Swift 6 concurrency crashes** — Khoa. Strict concurrency kills
  warnings, not runtime crashes; common triggers: closures inheriting
  `@MainActor`, `receive(on:)` placement in Combine, delegate isolation
  mismatches. Fix by restructuring to the concurrency model, not local
  annotations. (Our host uses async timeline providers + `NSLock`-guarded
  caches — keep isolation explicit.)

## Tools mentioned

- **SwiftMetalNumerics** (Bugra Acemoglu) — GPU numerical computing on Apple
  Silicon (Metal/MPS + Accelerate/LAPACK); FFT/STFT, convolution, NN layers.
  Not relevant now; note for future on-device signal/inference work.
- **SwiftUI Preview Runner** (Aryan Rogye) — compiles SwiftUI to a dylib,
  `dlopen` + `NSHostingView` to render previews in a host app / AI workflows /
  MCP validators. macOS-only. Conceptually close to our "render SwiftUI from an
  external description" approach — worth a look if we build preview tooling.
