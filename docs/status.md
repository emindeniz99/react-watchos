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
| ① **Logic-tested** | Pure logic unit-tested off-device | `pnpm test` (278 JS, vitest) + `swift test` (128, Linux: Core/Support/Runtime) — counts drift; treat as point-in-time (2026-07-02) |
| ② **Builds for watchOS** | The SwiftUI host/widget compiles for the watch | `react-native-watchos-build.yml` (macOS/Xcode) — `BUILD SUCCEEDED` |
| ③ **Device/sim-verified** | Exercised on a watchOS simulator or real Apple Watch | manual; noted per row |
| ⛔ **Blocked** | Needs an unreleased OS/SDK, or hardware we don't have | noted per row |

Linux `swift test` (①) verifies the **wire decode** of props — not the SwiftUI
view. So for anything that renders or touches native frameworks, the **watchOS
build (②) is the real gate**, and behavioral correctness isn't guaranteed until
③. Most native features below are at ② with ③ as the standing gap.

## Capability matrix

| Capability | Level | Evidence / note |
|---|---|---|
| React → JSON tree → SwiftUI renderer + sync commit pipeline | ② | reconciler [renderer.ts](../js/src/renderer.ts); wire decode in `swift test`; host builds green |
| 39 UI primitives (Stack/Text/Gauge/Map/Alert/Sheet/Section/Grid/Chart/Toolbar/…) | ② (the 2026-07-02 additions — presentations, rich text, Grid/Chart/Toolbar batch — are ① → ② pending) | contract is single-sourced + drift-guarded ① ([component-contract.test.ts](../js/test/component-contract.test.ts)); views in `NodeView.swift` build green (②) |
| Digital Crown, gestures, Slider/Stepper/DatePicker/Picker | ② | prop decode ①; views ② — on-device feel is ③ |
| WatchConnectivity — watch→phone (`sendToPhone`) + phone→watch | ② | `PhoneConnectivity` builds ②; **iPhone-side WCSession still needs wiring in the Expo companion app** |
| `fetch` over URLSession (WHATWG subset) | ② | `FetchPlan` request/response parsing ① (`FetchPlanTests`); URLSession orchestration ② |
| Sensors / HealthKit push streams | ② | builds ②; real sensor behavior is ③ (needs a device) |
| BLE bridge (event-driven `ble`/`ble.state`/`ble.notify`) | ② | builds ②; connect/write redesign + ③ device-verify pending (see backlog CX-017 remaining-ops) |
| Complications + Smart Stack widgets (timeline, snapshot) | ② | `WidgetSnapshot.currentIndex` ① (`WidgetSnapshotTests`); widget scheme builds green ② |
| Smart Stack **relevance ranking** (per-entry score/duration) | ② | `TimelineEntryRelevance(score:duration:)` wired in `ReactWidgets.swift` (CX-017) |
| Smart Stack **predictive `relevantContexts`** (date/location surfacing) | ② | `ReactTimelineProvider.relevance()` maps hints → RelevanceKit `RelevantContext` (.location/.date) → `WidgetRelevance` (CX-017); widget Xcode build SUCCEEDED. Actual Smart-Stack surfacing is ③ (device-only). |
| OTA update channel — signed, anti-rollback, transactional, keyId rotation | ② | heavy logic ① (`UpdatePlan`/`OTARecord`/`VersionPolicy` + Node↔CryptoKit interop in `swift test`); host applies it ②. See [ota-signing.md](./ota-signing.md) |
| Liquid Glass (`glass`), double-tap (`primaryAction`), glass button styles (`buttonStyle="glass\|glassProminent"`) | ② | `#available(watchOS 26.0 / 11.0)`-gated; GlassButtonStyle verified watchOS 26.0 via Apple docs JSON; builds ② |
| **watchOS 27 reorderable containers** (drag-to-rearrange in List/Grid) | ⛔ **Blocked** | Same SDK gate as on-device AI: symbols need Xcode 27 to compile (CX-002 precedent). Track for when the macOS workflow moves to Xcode 27. ToolbarSpacer checked and NOT on watchOS (docs JSON) — not a gap. |
| Layout modifiers (`padding`/`frame`/`background`/`cornerRadius`/`opacity`/`tint`, stack `alignment`) | ① → ② pending | parsing ① (`RNStyleModifierTests`, wire pass-through in [primitives.test.tsx](../js/test/primitives.test.tsx)); the SwiftUI application (NodeView `LayoutModifier` + widget parity chain) needs the next macOS build (②) — visual correctness is ③ |
| Theme/token layer (`useTheme`/`createTheme`/`ThemeProvider`) | ① | pure JS — tokens resolve before the wire ([theme.test.tsx](../js/test/theme.test.tsx)); nothing native to gate |
| Per-node `animation` prop | ① → ② pending | parsing ① (`RNStyleAnimationTests`); `.animation(_:value:)` application needs the macOS build (②); actual motion is ③. Widgets ignore it by design |
| Boot-time OTA signature re-verify (NF-35) | ① → ② pending | signedMessage parity ① (`OTARecordSignedMessageTests`); the evaluateOTA hook needs the macOS build (②) |
| **On-device AI** (`generateText` / Foundation Models) | ⛔ **Blocked** (gate fixed) | Gate corrected to **`watchOS 27.0`** (Apple docs: Foundation Models' `LanguageModelSession` is watchOS 27.0+ beta) and `maxTokens` wired to `GenerationOptions.maximumResponseTokens` (CX-002). The FoundationModels block still can't be **built** without the **watchOS 27 SDK (Xcode 27)** — on the current SDK it compiles out and `generateText` rejects "unavailable" — and no stable watchOS 27 device exists yet, so it's not usable by apps. A runtime `isOnDeviceAIAvailable()` query exists (resolves `false` until the FM path is built on watchOS 27). Remaining: device-verify on Xcode 27. |
| Device info (`getDeviceInfo` + accessibility state + `enableWaterLock`) | ① → ② pending | invoke routing drift-tested ① (`codegen.test`); WKInterfaceDevice + WKAccessibility snapshot / Water Lock are watchOS-gated ② |
| Keychain secure storage (`Keychain.*`) | ① → ② pending | invoke routing ①; Security-framework handler ② |
| Speech synthesis (`speak`/`stopSpeaking`) | ① → ② pending | invoke routing ①; AVSpeechSynthesizer handler ② |
| Extended runtime session | ① → ② pending | invoke routing ①; WKExtendedRuntimeSession handler ② (needs Info.plist session reason; device-only behavior ③) |
| Background refresh (`scheduleBackgroundRefresh` + `onBackgroundRefresh`) | ① → ② pending | invoke routing ①; full path wired — WKApplication schedule + `ReactWatchAppDelegate` fire→JS delivery (scaffold adds the `@WKApplicationDelegateAdaptor`) ② |
| In-app purchase (StoreKit 2) | ① → ② pending | invoke routing ①; StoreKit handlers ②; real purchases are App-Store-Connect + device ③ |
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
