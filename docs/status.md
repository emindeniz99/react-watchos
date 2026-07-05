# Status — what's actually verified

The honest "can I rely on X today?" view, kept **separate from the forward
plan** in [roadmap.md](./roadmap.md) and from the work queue in
[code-review-2026-06-25-1817-merged.md](./code-review-2026-06-25-1817-merged.md)
(THE backlog). roadmap.md describes *intent and history*; this file describes
*verified current state* and links every claim to evidence. When the two
disagree, **this file wins** for "is it real yet?".

> Why this exists (CX-027): "shipped" was being claimed inline next to
> aspirational items, and two features were overclaimed — on-device AI and the
> predictive part of Smart Stack relevance. This page is the single place where
> a status claim has to be falsifiable.

## Verification ladder

Every capability sits at one level. Higher levels subsume the lower ones.

| Level | Means | How it's checked |
|---|---|---|
| ① **Logic-tested** | Pure logic unit-tested off-device | `pnpm test` (351 JS, vitest) + `swift test` (188 test funcs, Linux/macOS: Core/Support/Runtime) — counts drift; treat as point-in-time (2026-07-04) |
| ② **Builds for watchOS** | The SwiftUI host/widget compiles for the watch, and the suite runs on the watch simulator | `pnpm test:swift:watch` (`xcodebuild test`, watchOS sim) — **TEST SUCCEEDED locally 2026-07-04** (watchOS 26.2 sim, Xcode 26.3). The `react-native-watchos-build.yml` CI workflow exists but has **never run** (B1 — Actions disabled at repo level); until it's green, ② evidence is these local runs. |
| ③ **Device/sim-verified** | Exercised on a watchOS simulator or real Apple Watch | manual; noted per row |
| ⛔ **Blocked** | Needs an unreleased OS/SDK, or hardware we don't have | noted per row |

Linux `swift test` (①) verifies the **wire decode** of props — not the SwiftUI
view. So for anything that renders or touches native frameworks, the **watchOS
build (②) is the real gate**, and behavioral correctness isn't guaranteed until
③. Most native features below are at ② with ③ as the standing gap.

## Capability matrix

| Capability | Level | Evidence / note |
|---|---|---|
| React → JSON tree → SwiftUI renderer + sync commit pipeline | ③ | reconciler [renderer.ts](../js/src/renderer.ts); wire decode in `swift test`; host builds green — **plus first on-sim ③ run (2026-07-05, Ultra 3 49mm):** the full React→JSON→SwiftUI→commit loop drives live UI — Counter `useState` re-render (0→3), Hydration + Shopping App-Group atomic counter (`counterAdd`/`counterValue`) increment + persist across navigation, NavigationLink push/pop, Toggle image swap. Caveat: the App-Group path only works when the app is **signed** — a `CODE_SIGNING_ALLOWED=NO` build strips the `group.com.emindeniz99.reactwatch` entitlement and every shared-state screen silently reads 0; build ad-hoc signed (`CODE_SIGN_IDENTITY="-"`). Also render-verified on the same run: Gallery (Slider, ProgressView, ZStack), a MapKit Map (3 tinted SF-Symbol annotations + polyline route, new `/map` demo), and TabView draws its 2 pages + page-indicator dots (the `.verticalPage` swipe wouldn't advance via synthetic touch — a sim-input nuance, not a renderer defect). Crown/gesture *feel*, widgets/complications, BLE/phone/AI/OTA remain ② (not yet exercised on-sim). |
| 40 UI primitives (Stack/Text/FormattedText/Gauge/Map/Alert/Sheet/Section/Grid/Chart/Toolbar/…) | ② | contract is single-sourced + drift-guarded ① ([component-contract.test.ts](../js/test/component-contract.test.ts)); views in `NodeView.swift` build green (②) |
| Digital Crown, gestures, Slider/Stepper/DatePicker/Picker | ② | prop decode ①; views ② — on-device feel is ③ |
| WatchConnectivity — watch→phone (`sendToPhone`) + phone→watch | ② | `PhoneConnectivity` builds ②; iPhone side wired in the companion app (`react-native-watch-connectivity` listener **calls the reply handler**, so the watch's `sendToPhone` promise settles instead of timing out); the end-to-end paired exchange is ③ (needs a paired sim/device pair) |
| `fetch` over URLSession (WHATWG subset) | ② | `FetchPlan` request/response parsing ① (`FetchPlanTests`); URLSession orchestration ② |
| Sensors / HealthKit push streams | ② | builds ②; real sensor behavior is ③ (needs a device) |
| BLE bridge (event-driven `ble`/`ble.state`/`ble.notify`) | ② | builds ②; connect/write redesign + ③ device-verify pending (see backlog CX-017 remaining-ops) |
| Complications + Smart Stack widgets (timeline, snapshot) | ③ | `WidgetSnapshot.currentIndex` ① (`WidgetSnapshotTests`); widget scheme builds green ②; **on-sim ③ (2026-07-05, Ultra 3):** the widget extension loads in `ClockFace` and renders shared App-Group data on the watch face — a Groceries complication showing "1 of 4 done" with a matching progress bar, reading the same store the app writes (`pnpm run:watch` re-signs the `.appex` with the App Group — a manual re-sign is required because the sim strips App-Group entitlements). The write→live-refresh loop (app write → WidgetKit reload → face updates) is WidgetKit-scheduled and not yet timed on-sim |
| Smart Stack **relevance ranking** (per-entry score/duration) | ② | `TimelineEntryRelevance(score:duration:)` wired in `ReactWidgets.swift` (CX-017) |
| Smart Stack **predictive `relevantContexts`** (date/location surfacing) | ② | `ReactTimelineProvider.relevance()` maps hints → RelevanceKit `RelevantContext` (.location/.date) → `WidgetRelevance` (CX-017); widget Xcode build SUCCEEDED. Actual Smart-Stack surfacing is ③ (device-only). |
| OTA update channel — signed, anti-rollback, transactional, keyId rotation | ② | heavy logic ① (`UpdatePlan`/`OTARecord`/`VersionPolicy` + Node↔CryptoKit interop in `swift test`); host applies it ②. See [ota-signing.md](./ota-signing.md) |
| Liquid Glass (`glass`), double-tap (`primaryAction`), glass button styles (`buttonStyle="glass\|glassProminent"`) | ② | `#available(watchOS 26.0 / 11.0)`-gated; GlassButtonStyle verified watchOS 26.0 via Apple docs JSON; builds ② |
| **watchOS 27 reorderable containers** (drag-to-rearrange in List/Grid) | ⛔ **Blocked** | Same SDK gate as on-device AI: symbols need Xcode 27 to compile (CX-002 precedent). Track for when the macOS workflow moves to Xcode 27. ToolbarSpacer checked and NOT on watchOS (docs JSON) — not a gap. |
| Layout modifiers (`padding`/`frame`/`background`/`cornerRadius`/`opacity`/`tint`, stack `alignment`) | ② | parsing ① (`RNStyleModifierTests`, wire pass-through in [primitives.test.tsx](../js/test/primitives.test.tsx)); the SwiftUI application (NodeView `LayoutModifier` + widget parity chain) watch-sim compile+test green (2026-07-04) — visual correctness is ③ |
| Theme/token layer (`useTheme`/`createTheme`/`ThemeProvider`) | ① | pure JS — tokens resolve before the wire ([theme.test.tsx](../js/test/theme.test.tsx)); nothing native to gate |
| Per-node `animation` prop | ② | parsing ① (`RNStyleAnimationTests`); `.animation(_:value:)` application watch-sim compile+test green (2026-07-04); actual motion is ③. Widgets ignore it by design |
| Boot-time OTA signature re-verify (NF-35) | ② | signedMessage parity ① (`OTARecordSignedMessageTests`); the evaluateOTA hook watch-sim compile+test green (2026-07-04) |
| **On-device AI** (`generateText` / Foundation Models) | ⛔ **Blocked** (gate fixed) | Gate corrected to **`watchOS 27.0`** (Apple docs: Foundation Models' `LanguageModelSession` is watchOS 27.0+ beta) and `maxTokens` wired to `GenerationOptions.maximumResponseTokens` (CX-002). The FoundationModels block still can't be **built** without the **watchOS 27 SDK (Xcode 27)** — on the current SDK it compiles out and `generateText` rejects "unavailable" — and no stable watchOS 27 device exists yet, so it's not usable by apps. A runtime `isOnDeviceAIAvailable()` query exists (resolves `false` until the FM path is built on watchOS 27). Remaining: device-verify on Xcode 27. |
| Device info (`getDeviceInfo` + accessibility + locale/is24Hour + `enableWaterLock`) | ② | invoke routing drift-tested ① (`codegen.test`); WKInterfaceDevice + WKAccessibility snapshot / Water Lock are watchOS-gated ② |
| MapKit POI search (`searchPOI` → MKLocalSearch), live location tracking (`startLocation`/`SensorBridge`), full-screen + auto-fitting `Map` | ③ | invoke routing drift-tested ① (`codegen.test`); `handleSearchPOI`/`SensorBridge` ②; **on-sim ③ (2026-07-05, Ultra 3):** the `/map-search` "Places" demo — a full-screen map with a floating search field — live-tracks the watch's location via CoreLocation's continuous stream (`startLocation`, focus-gated), drawing a blue marker that follows a moving sim location (verified with `simctl location start`, a waypoint route from NYC toward Brooklyn: the marker and camera tracked the move in real time), biases the search on the live fix, and the controlled camera zooms to fit search results too (searched "Park" → 15 NYC parks framed alongside the blue marker; falls back to SF when location is unavailable) |
| Keychain secure storage (`Keychain.*`) | ② | invoke routing ①; Security-framework handler ② |
| Speech synthesis (`speak`/`stopSpeaking`) | ② | invoke routing ①; AVSpeechSynthesizer handler ② |
| Audio playback (`playAudio`/`stopAudio` + `onAudioFinished`) | ② | invoke routing ①; AVAudioPlayer + AVAudioSession `.playback` handler ② (downloads the URL, routes to Bluetooth/speaker) |
| Extended runtime session | ② | invoke routing ①; WKExtendedRuntimeSession handler ② (needs Info.plist session reason; device-only behavior ③) |
| Background refresh (`scheduleBackgroundRefresh` + `onBackgroundRefresh`) | ② | invoke routing ①; full path wired — WKApplication schedule + `ReactWatchAppDelegate` fire→JS delivery (scaffold adds the `@WKApplicationDelegateAdaptor`) ② |
| In-app purchase (StoreKit 2) | ② | invoke routing ①; StoreKit handlers ②; real purchases are App-Store-Connect + device ③ |
| DevTools | ② note | a **remote inspector** (`startInspector` tees `console.log` + tree snapshots over `fetch`), **not** the official React DevTools — QuickJS has no WebSocket transport |
| macOS / tvOS targets | — | not built; cross-platform core extraction is a roadmap bet, not current |

## Two corrected overclaims (the CX-027 trigger)

- **On-device AI is blocked, not shipped.** roadmap.md previously listed it as
  "shipped (watchOS 26+)". The wrong-version gate is now **fixed** (→ `watchOS
  27.0`, the actual Foundation Models floor) and `maxTokens` is wired, but it
  stays unreachable until an Xcode-27 / watchOS-27 build can compile and verify
  the FoundationModels path (CX-002). Until then, apps must not depend on
  `generateText`.
- **`relevantContexts` is partial.** Smart Stack relevance **ranking** (sorting
  entries by score) is real (②). The **predictive** surfacing of a widget at a
  date/location from `relevantContexts` is decoded but **not applied** (CX-017).

## How to keep this honest

When you mark something "shipped" anywhere in the docs, it must map to a row
here at level ② or ③ with an evidence link. New native features land at ②
(watchOS build green) and only move to ③ after a simulator/device run. If you
can't link evidence, it belongs in [roadmap.md](./roadmap.md), not here.
