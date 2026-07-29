# Roadmap

Forward plan for `react-watchos`, organized into three parallel
tracks that touch mostly disjoint files. Derived from a reviewed feedback
pass; corrections from that review are folded in. Priorities: **P0** =
unblocks real apps, **P1** = strong value, **P2** = polish.

> **Verified status lives in [status.md](./status.md), not here.** This file is
> forward-looking plan + history; when it says "shipped", read that as a
> historical note and check status.md for the evidence-backed current level.
> status.md is the single source of truth for "is it real yet?" (CX-027).

## Already shipped (don't redo)

- **Design system** (2026-07 review §2.4, all three tiers) — shared layout
  modifiers (`padding`/`frame`/`background`/`cornerRadius`/`opacity`/`tint`,
  stack `alignment`), the `useTheme`/`createTheme` token layer, and per-node
  `animation`. SwiftUI application pends the macOS build (see status.md).
- **Digital Crown** (`CrownRotation`, T1-P0) — done.
- **`setInterval`/`clearInterval` shim** (T2-P0) — done.
- **CI bundle-size budget** (`check:size`, T2-P1) — done.
- **WatchConnectivity bridge** (`sendToPhone`/`onPhoneMessage`, T3-P0) —
  both sides wired: the watch's `PhoneConnectivity` + the companion app's
  `react-native-watch-connectivity` listener, which acknowledges through the
  reply handler so `sendToPhone`'s promise settles. Remaining: exercise the
  paired exchange on a real sim/device pair (③ in status.md).
- **`fetch` shim over URLSession** (T3-P1) — done.
- **ErrorBoundary** + on-device error banner. Richer dev overlay: the JS layer
  is done — ErrorBoundary forwards React's `componentStack`, and the remote
  inspector captures errors (message + stack + componentStack, `console.error`
  teed) into an ERRORS panel. Remaining: enriching the native on-device banner
  to show it (macOS-build-gated).
- **VoiceOver labels** (`A11yProps`), **Dynamic Type** (`textStyle` scales
  automatically; `preferredContentSizeCategory` exposed via `getDeviceInfo`),
  and **reduce-motion** (native `animated()` suppresses a node's `animation`
  under `@Environment(\.accessibilityReduceMotion)`; also on `getDeviceInfo`).
- **TimerText**, **runSync / native-event push**, **codegen wire contract**,
  **bytecode precompile**, **no-op commit bailout**, **Linux CI + swift
  contract tests**.

- **Slider + Stepper** (T1-P1), **gestures** (onLongPress + onSwipe, T1-P1),
  **bitmap/photo Image** (URL + base64), **BLE bridge** (movie remote),
  **fetch** (+ timeout + headers), **focus** (`focusable`, T1-P2),
  **Dynamic Type** (`textStyle`, T3-P2), **richer dev error overlay**
  (stack + scrollable, T2-P2), **iPhone-side WatchConnectivity**
  (react-native-watch-connectivity in the companion app), **Bluetooth
  entitlement** — all done.

Also shipped: **DatePicker**, **onDrag** scrub (T1), **four sensor streams**
(T3-P1 — heart rate / motion / gyroscope / location; the HealthKit side is a
heart-rate read only, *not* steps/energy/sleep/workout control),
**Map** primitive, **Smart Stack relevance ranking** (per-entry score;
the *predictive* `relevantContexts` surfacing is decoded-not-applied — CX-017,
[status.md](./status.md)), **Liquid Glass** (`glass`), **OTA update channel**
(`applyUpdate`), **React Compiler** in the esbuild pipeline (auto-memoization),
**double-tap** (`primaryAction` → `handGestureShortcut(.primaryAction)`,
watchOS 11+), and the **QuickJS bridging-header config plugin** (toward the
macOS build). **On-device AI** (`generateText`) is implemented but
**blocked/unreachable** until the watchOS-27 gate fix + Xcode 27 (CX-002,
[status.md](./status.md)) — *not* "shipped".

**DevTools — shipped as a remote inspector**, not the official React
DevTools. Full DevTools needs a WebSocket transport QuickJS doesn't provide,
so instead `startInspector({url})` tees `console.log` into a ring buffer and
POSTs `inspectorSnapshot()` (the serialized tree via `__inspect` + logs) over
the existing `fetch` every 1 s; `js/scripts/inspector.mjs` is a Node viewer.
The `injectIntoDevTools` hook is still wired for when a transport exists.

Dropped after measurement: **tree-diff** (see Track 2 — not warranted at
watch scale).

**Suspense — attempted, not supported (by design).** The renderer is
sync-first (`updateContainerSync` + `flushSyncWork` on a discrete priority),
which is what makes commits deterministic and verifiable in `qjs`. Suspense
*boundaries* render (fixed by returning a non-null empty `getRootHostContext`,
which a `null` context crashed on), but Suspense-**for-data** never commits:
the concurrent retry lanes that resolve a thrown promise are never driven by
the sync-first loop. Driving retries via `flushSyncFromReconciler(updateContainer)`
and the classic throw-promise pattern both failed. Recommendation for apps:
the explicit `useState` + `fetch` loading pattern, not `<Suspense>`. Revisit
only if we move to a concurrent (time-sliced) scheduler, which would trade
away the sync-commit determinism the test harness relies on.

**Live Activities — deferred (by design).** They're iOS ActivityKit
(authored on iOS, only *surfaced* on the watch Smart Stack), need a
separate iOS widget target we don't have, and are push/ActivityKit-driven
rather than rendered through our React pipeline — so they don't fit and
can't be verified here. The Smart Stack *ranking* (relevance scores) is
already implemented. Revisit only if a real app needs an iOS Live Activity.

All SwiftUI/CoreBluetooth code added across these passes is **unverified
until the macOS build runs green** — that's the gate.

## Approved & in-flight (2026-07-05 session)

Tracked here for easy follow-up; each lands as its own commit.

- **Rich-text nesting fix — shipped.** The widget interpreter's `textSegment`
  didn't recurse into nested `<Text>`, so rich text ≥2 deep dropped its deepest
  text on the complication only. Fixed in place + a JS wire test for the ≥2-deep
  shape + a structural parity guard (both interpreters' `textSegment` must fold
  children). Found by the
  [interpreter hand review](./human-review-2026-07-05-interpreter-duplication.md).
- **Boot parse-time gate — shipped.** embed-smoke now measures + gates
  cold-start (`[boot]` line, 250 ms dev-relative tripwire) so a JS-bundle-size
  budget raise is paired with its cold-start cost. See
  [budgets-and-limits.md](./budgets-and-limits.md).
- **Cognitive-complexity ratchet — shipped, ongoing.** Biome's
  `noExcessiveCognitiveComplexity` is gated at 25 (today's worst); drive the 10
  flagged hot paths toward the Sonar default of 15 when they're touched
  ([quality-gates.md](./quality-gates.md)).
- **ARCH-10 Phase A — SHIPPED (verified on the watchOS build).** Extracted the
  byte/near-identical SwiftUI-mapping helpers (color/systemColor, semanticFont,
  the three alignments, chartMark, styled, textSegment) into a new watchOS-only
  `ReactWatchUI` module (`RNUI`) that both `NodeView` and `WidgetNodeView`
  import; the second `textSegment` copy is gone, so the nesting drift can't
  recur and parity is **structural**, not golden-test-enforced. The two files
  keep only thin forwarders for the high-call-site `color`/`styled`. Verified
  green: `xcodebuild` for the watchOS destination + `swift test` (199) + the JS
  suite (377, golden unchanged = no prop-read drift). The layout-modifier chain
  (Group B) and the render switch stay per-interpreter for now. Design basis:
  [human-review-2026-07-05](./human-review-2026-07-05-interpreter-duplication.md).
- **ARCH-10 Phase B — DEFERRED; do NOT do it now.** Unifying the render *switch*
  (app interactive vs widget static/degraded) is the higher-risk half and is NOT
  needed for the watch: the container/display cases are already shared (Phase A
  helpers), and the ~12 interactive/presentation/nav cases genuinely DIFFER per
  interpreter — they're not duplication, so merging them removes none. At two
  targets the two clear switches + the M6 parity golden are fine.
  **If it is ever done (target #3 — an iOS widget host, §7), do it as
  COMPOSITION, not a switch full of `if isInteractive`:** a `RenderContext`
  protocol whose methods (`button(node,children)`, `presentation(node)`,
  `slider(node)`, …) each interpreter implements, so the single shared switch
  dispatches `ctx.button(…)` with NO conditionals — polymorphism picks
  interactive-vs-degraded and the container/display cases stay context-free.
  Design the protocol for all three targets at once. The SwiftUI `some
  View`/type-erasure friction this incurs is itself part of why it's not worth
  it below three targets.
- **Theme type-safety follow-up — planned.** Borrow Restyle's compile-time
  pattern for the token layer (`type Theme = typeof theme` + token-keyed props):
  autocomplete + typo-catching on token props, **types-only, zero runtime/OTA
  bytes**. Prior-art verdict was keep-and-improve (not adopt a lib, not go
  native — watchOS is always-dark so the native theming win is nil); see the
  theme decision note in [prior-art.md](./prior-art.md).

## Track 1 — Input & interaction

Owns `components.ts`, `NodeView.swift` (append-only), demo screens.

| Item | Pri | Effort | Notes |
|---|---|---|---|
| **Digital Crown** | P0 | M | A focusable `<CrownRotation value range step onChange>` over SwiftUI `digitalCrownRotation` (+ optional crown haptic). Implement as a **component/prop, not a `useCrownRotation` hook** — it must bind to a specific SwiftUI view's crown. Today the Crown only works implicitly via `Picker`. Demo: Crown scrubs a number. |
| Gestures | P1 | M | `onLongPress` (new event kind, trivial), `DragGesture` (continuous — **coalesce/throttle**, it's the high-frequency case the cost model warns about), swipe-to-dismiss. |
| Slider / Stepper / DatePicker | P1 | M | Each = prop type + `NodeView` case + render test + fixture. Slider is largely Crown+drag; Stepper is easy; DatePicker is a real primitive. |
| Focus management | P2 | M | Only one Crown-focusable element at a time on watchOS; needs an addressable focus model. Gates multi-Crown screens. |

## Track 2 — Runtime, rendering & performance

Owns `shims.ts`, `renderer.ts`, `scripts/`, CI.

| Item | Pri | Effort | Notes |
|---|---|---|---|
| **`setInterval` shim** | P0 | S | The confirmed bug: `setInterval`/`clearInterval` are undefined in QuickJS, so an interval-driven update throws. Add them on top of the existing `setTimeout`→`__host.setTimer` bridge (re-arm on fire). *Async `setState` already commits via the scheduler's `setTimeout` hop* — this is the missing piece, not a scheduler redesign. Document the scheduler integration. Accept: an interval counter commits with no tap. **Land first** — unblocks Track 3's fetch/sensors. |
| Tree diff / patch protocol | P1→**dropped** | L | **Measured (`treediff.bench`): 200 rows = ~13 KB, ~0.04 ms/serialize.** In-process serialize+decode is negligible and SwiftUI re-diffs the decoded tree regardless, so a patch protocol is **not warranted** at this scale — confirmed, not built. The no-op bailout is the cheap partial already in place. Revisit only if a profile on a real device shows commit cost (e.g. thousands of nodes). |
| Minified/bytecode shipped artifact + CI size budget | P1 | S | Ship minified (`build:min`, ~halves it) or `.qbc` for production; keep unminified default for readable on-watch traces. Add a CI byte-size budget check. |
| Richer dev error overlay | P2 | S | **JS layer shipped:** ErrorBoundary forwards `componentStack`; the remote inspector rings errors (message/stack/componentStack + `console.error` tee) into an ERRORS panel. Remaining: surface it in the native on-device banner (macOS-build-gated). |
| **JSRuntime owning-queue confinement (M1)** | P1 → **shipped** | M | The engine's contract is "one thread per runtime": the app runtime lives on main, but WIDGET runtimes are created/evaluated/discarded on WidgetKit provider threads while the default timer path delivered `__fireTimer` on main. **Shipped (full fix):** `JSRuntime` captures an owning serial queue at init (app = main; widget = its own private queue; the OTA validator/compiler pass theirs), every entry routes through it structurally — inline when already on it, `sync` hop otherwise — timers fire on it, and the old DEBUG main-thread assertions are gone (confinement is now guaranteed, not policed). Intent-mode widget JS still refuses timers loudly, but because they are *useless* in a discard-after-return pass, not unsafe. |
| **Interpreter per-prop parity (M6 interim)** | P1 → **shipped** (interim; ARCH-10 still pending before a 2nd platform) | M | The two SwiftUI interpreters share parsing (RNStyle/RNFormat) and a case-presence contract test, but per-prop behavior inside each case is still parity-by-comment (applyLayout chain, color tables, alignment mappers, chart builders). Until the ARCH-10 single-interpreter refactor (one NodeView parameterized by a RenderContext — required before any second platform target), add the 2026-07-04 review's interim ask: a schema-generated per-prop golden parity test. |
| Lazy navigation (native-backed) | P2 → **shipped** (ARCH-09, 2026-07-16) | M | **Option B, built.** The eager-mount root cause (the native push was *optimistic* — `RoutedNavigationStack` ran its `navigationDestination` a bridge hop before JS committed) is gone: event dispatch now returns a structured `{handled, accepted, reason}` verdict, the stack **confirms with JS before animating** (a declined/failed proposal animates nothing; pops stay always-accepted), and `NavigationRoute` mounts children only for the root + the active path's winners (memoized `StackWinners`), so inactive routes are neither mounted nor serialized. BREAKING: screen-local state drops on pop; inactive-screen effects must use `useFocusEffect` (already the documented pattern). Measured on the vendored-engine bench: launch tree **152 → 48 nodes / 13.4 → 4.1 KB**, perDispatch **1.32 → ~0.52 ms**. JS + engine verified (nav suite 27/27, qjs-smoke lazy contract, swift test 215); the Swift halves are watchOS-only — on-device transition-latency validation still owed. |

## Track 3 — Platform integration & connectivity

Owns the companion app, new `__host` methods, native-event streams.

| Item | Pri | Effort | Notes |
|---|---|---|---|
| **WatchConnectivity bridge** | P0 → **wired** | M | Both sides in place: phone→watch via `registerNativeListener`/`__pushNativeEvent`, watch→phone via `sendToPhone` (invoke channel), and the companion app's `react-native-watch-connectivity` listener replies so the watch promise settles. Accept criterion (a phone message updates watch UI live) still needs a paired sim/device run — ③ in status.md. **Background channels shipped too (ARCH-12, 2026-07-16):** outbound `updateApplicationContext` (latest-wins state) / `transferUserInfo` (FIFO queue surviving suspension) over invoke; inbound events split by delivery semantics with `onApplicationContext`/`onUserInfo` (BREAKING: phone-pushed context no longer arrives on `onPhoneMessage`). JS-verified (connectivity 7/7); the watch-only delegates await the next Xcode build. |
| Networking (`fetch`) | P1 | M | A `fetch` shim backed by `URLSession` through a new async `__host` method. Promise-based → **depends on Track 2's async/`setInterval` work** for deterministic flush. |
| Sensors / HealthKit | P1 → **partial** | M-L | **Shipped:** heart rate, motion, gyroscope and location as native-event streams on the push channel; HealthKit entitlement/privacy plumbing done. Builds directly on `__pushNativeEvent`. **Not shipped:** workout sessions are *not* an exposed capability — heart rate comes from a hidden `.other` `HKWorkoutSession` that exists purely as an HR pump and is never saved, so there is no start/pause/end/save API. Nor are there HealthKit reads (steps, active energy, sleep, SpO2). Those remain the top gap. |
| Dynamic Type + reduce-motion | P2 → **shipped** | S | Labels done; `textStyle` gives Dynamic Type scaling for free (semantic fonts), and `getDeviceInfo` exposes `preferredContentSizeCategory`. Reduce-motion now honored natively: `LayoutModifier.animated()` skips a node's `animation` under `@Environment(\.accessibilityReduceMotion)`, and the flag is on `getDeviceInfo` for JS-driven transitions. On-device feel is ③. |
| Live Activities / Smart Stack+ | P2 | M | Extends the existing widget timeline pipeline. |
| **i18n track (M7)** | P1 → **shipped** | M | QuickJS has no `Intl`; the gap was undocumented until the 2026-07-04 review. Step 1 SHIPPED: `locale`/`language`/`is24Hour` in `getDeviceInfo()` + README limitation. Step 2 SHIPPED: `<FormattedText>` — a declarative date/number primitive rendered natively with the device locale (shared `RNFormat` kernel in Support, Linux-tested; full widget support). Step 3 SHIPPED: `createTranslations`/`TranslationProvider`/`useTranslation` — a message translation layer (typed `t()`, `{placeholder}` interpolation, an app-supplied plural-rule seam since there's no `Intl.PluralRules`), plain data + one context resolved in JS like the theme layer, Linux-tested. |
| **API reference (M12)** | P1 → **shipped** | M | ~110 value exports + ~80 types with no consumer reference doc; a large slice of the public surface (Slider/Stepper/DatePicker/Map/CrownRotation/SwipeAction/ErrorBoundary/sensors/defineMessages/startInspector) appears in no consumer document. Generate `docs/api.md` from the TS types/JSDoc (typedoc) and emit the capability table from the codegen schema so it can't drift. |
| **OTA hardening trio (2026-07-04 review §6.11)** | P1 → **shipped** | M | Post-launch security levers, none built yet: (a) a signed version-floor/expiry inside `signedMessage` (revocation — today a validly-signed old-but-≥high-water bundle can be replayed forever), (b) OTA observability (releaseId/keyId/version telemetry from app + widget so a fleet's bundle spread is knowable), (c) https enforcement on manifest/bundle URLs (currently http is accepted; the signature protects integrity but not privacy/downgrade-of-metadata). |

## Sequencing & dependencies

- **`setInterval` shim (T2-P0) lands first** — it's the cheapest and it
  unblocks fetch (T3-P1) and timer-driven sensor streams (T3-P1).
- The three P0s (Crown, WatchConnectivity, setInterval) are otherwise
  independent and parallelizable across agents.
- **Hard gate:** every SwiftUI change is unverified until the macOS build
  (`.github/workflows/react-native-watchos-build.yml`) runs green. The
  Linux `swift test` only verifies *wire decode* of new props, not the view.
  Get that workflow green before trusting Crown/gestures/WatchConnectivity
  on-device.

## Cross-cutting rules (corrected)

For every new **primitive** (a node type with props):

1. TS prop interface in `components.ts` (append; extend `A11yProps`).
2. Export in `index.ts` (append).
3. `NodeView.swift` case (+ `WidgetNodeView.swift` if it can appear in a
   widget).
4. A schema assertion in `primitives.test.tsx` (the convention for added
   primitives; `render.test.tsx` is the original showcase).
5. A node in the Swift contract fixture (`contract-fixture.test.tsx` →
   the package's `swift test`) so the prop decode is checked on Linux.

Wire-contract rules:

- **Adding node types or props keeps `v: 1`** — `RNNode.props` is open and
  unknown types degrade via the `default:` case, so additive changes are
  backward-compatible. Bumping `v` per primitive would make the Swift
  decoder reject valid trees.
- **Bump `v` only for breaking changes to the shared structs** (`RNNode`,
  `RNTree`, `Published*`), and do it through `js/codegen/schema.mjs` so both
  Swift models regenerate together. New *payload structs* (not node types)
  also go through the schema.
- Keep pure-Foundation Swift Linux-compilable so `swift test` covers the
  contract without a Mac. SwiftUI-touching code (`NodeView` cases) is not
  Linux-testable — it needs the macOS workflow.

See [prior-art.md](./prior-art.md) for which of these align with how RN,
Raycast, and other production reconcilers solve the same problems.

---

# Future opportunities (web research, 2026)

Findings from a detailed scan of the 2026 platform, engine, React, and
market landscape, with the implications for this project. Sourced inline.

## 1. Strategic: generalize to "React → SwiftUI on any Apple platform"

The single biggest opportunity. SwiftUI now spans **iOS, iPadOS, macOS,
tvOS, watchOS, and visionOS** with the same view vocabulary
([Apple](https://developer.apple.com/visionos/)), and our renderer is
already "React commits → JSON tree → SwiftUI." The watch is the *hardest*
target (no UIKit/JSC, tiny screen); the same `NodeView` interpreter + QuickJS
bundle would run on the others with little change. Community proof exists —
[a2ui-swift](https://a2ui.org/ecosystem/renderers/) is a SwiftUI renderer
already covering iOS/macOS/visionOS/watchOS/tvOS.

Action: factor the SwiftUI interpreter + JS runtime out of the watch target
into a shared core, then add thin `tvos`/`macos` targets. tvOS is the
natural second target (10-foot UI, focus engine, the Crown's cousin). This
turns a watch demo into "**React Native for the parts of Apple that RN
can't reach**."

## 2. Ride watchOS 26's new APIs

watchOS 26 added exactly the surfaces this project already models
([Apple newsroom](https://www.apple.com/newsroom/2025/06/watchos-26-delivers-more-personalized-ways-to-stay-active-and-connected/),
[WWDC25](https://developer.apple.com/wwdc25/guides/watchos/)):

- **Fitness APIs** — real-time heart rate, gyroscope, all-day accelerometer,
  route maps. Makes the deferred **sensors/HealthKit (T3-P1)** the highest-
  value remaining feature: a watchOS app's killer differentiator is sensor +
  complication, and the React app gets these for free via the push channel.
- **Smart Stack Relevance API + Points-of-Interest signals** — extend our
  existing relevance scores with location/POI signals so widgets surface at
  the right place/time.
- **Control Widget API + iOS controls shared to watchOS** — our controls
  already match this; a shared control authored once could appear on both.
- **MapKit** (search, routing, overlays) → a new **`Map` primitive**
  (annotations + a route) — high value for the navigation app category.
- **Liquid Glass** design + new SwiftUI materials/tab/split views — adopt the
  new modifiers so apps look native to 2026, not 2023.

## 3. Engine & React perf

- **React Compiler** (React 19) auto-memoizes components, cutting re-renders
  ([React 19](https://reliasoftware.com/blog/new-features-and-improvements-in-react-19)).
  Adding it to the esbuild pipeline would reduce commit churn for free, on top
  of our no-op-commit bailout. Cheap, JS-side, verifiable here — strong
  near-term pick.
- **Static Hermes / Hermes V1** can compile JS to native and run typed
  bytecode ([RN Hermes](https://reactnative.dev/docs/hermes),
  [next-gen Hermes](https://blog.swmansion.com/welcoming-the-next-generation-of-hermes-67ab5679e184)).
  No watchOS build target exists yet, so QuickJS stays the pragmatic choice
  ([QuickJS vs Hermes](https://www.fractolog.com/2025/04/comparing-hermes-and-quickjs/));
  our `.qbc` bytecode is the QuickJS analog of Hermes `.hbc`. Track Static
  Hermes as a future engine swap behind the existing `HostBridge` seam.

## 4. Distribution: OTA / hot-reload in production (bounded)

Bundled interpreted JS is allowed, and OTA updates to the bundle are
permitted **for fixes and UI within already-reviewed functionality** — not
to add materially new native capability
([Apple 2.5.2](https://developer.apple.com/app-store/review/guidelines/),
[OTA policy](https://bitrise.io/blog/post/what-app-stores-allow-with-ota-updates-apple-and-google-policy-explained)).
Our dev live-reload could graduate to a production **EAS-Update-style** bundle
channel: ship UI fixes without an App Store round-trip, with a documented
guardrail that new host APIs still need a native release + review.

## 5. App opportunities this unlocks

2026 demand skews to glanceable, fast, **complication-first**, often
**BLE-/sensor-connected** apps
([independent watchOS apps](https://developer.apple.com/documentation/watchos-apps/creating-independent-watchos-apps)):
media remotes (validates the **BLE movie remote** we built — same shape as
podcast/streaming remotes), fitness + connected sensors (CGM, sports
equipment), navigation, timers, medication reminders. The reusable play is a
**starter-kit of React watch apps** (remote, tracker, timer, now-playing
complication) on top of this renderer.

## 6. On-device intelligence (implemented, blocked — see status.md)

`generateText` brokers Apple's **Foundation Models** (~3B on-device LLM) on the
watch — no network, no phone — through the `generate` host method, settled on
the main actor. **Status: blocked/unreachable today** — it's gated at
`watchOS 26.0` but Foundation Models is **watchOS 27.0+ (beta)**, so the fix
(gate→27, `maxTokens`, capability query) and an Xcode-27 build are still pending
(CX-002, [status.md](./status.md)). Natural extensions once it's reachable, all
behind the same `HostBridge` seam:

- **Streaming tokens** via the existing `__pushNativeEvent` channel (partial
  results as they decode), instead of one resolve.
- **Structured output** — Foundation Models `@Generable` guided generation
  maps cleanly onto a typed `generateObject(schema)`.
- **Tool calling** — let the model invoke our host methods (haptics, widgets,
  fetch) as tools.
- **App Shortcuts / Siri** — surface app actions to Siri so a phrase can drive
  the React app; pairs with the **double-tap** primary action already shipped.

## 7. Apple widget / timeline surfaces — watch-first, then everywhere

The moat isn't the engine (every other Apple platform already has JSC); it's
that our renderer emits an **archived, static SwiftUI timeline**, which is
exactly the out-of-process model WidgetKit/ActivityKit use — a shape RN's live
UIView reconciler structurally can't match, on any engine. So the renderer could
target every Apple timeline surface. Full inventory:

**Supported today (watchOS):**

- watchOS **WidgetKit** complications + Smart Stack widgets — the full
  interpreter (`ReactWidgetView`), timeline providers (`ReactTimeline`:
  `reactTimeline`/`reactSnapshotEntry`, currentIndex/reload-policy handling),
  the widget's own QuickJS runtime (`WidgetIntentRuntime`), per-`WidgetFamily`
  rendering (`familyKey`), and **interactive widget buttons** via AppIntent
  (`ReactWidgetButtonIntent`, watchOS 11+). Smart Stack *relevance ranking* is
  in; predictive `relevantContexts` surfacing is decoded-not-applied (CX-017).

**Missing — reachable by the same model, not yet targeted:**

- **iOS / iPadOS Home Screen + Lock Screen widgets** — everything is
  `#if os(watchOS)` today; needs an iOS widget target/host and the interpreter
  ungated for iOS. The biggest single surface, and it also brings **iOS StandBy**
  and **macOS Notification Center** widgets largely for free.
- **Live Activities / ActivityKit** (Dynamic Island + Lock Screen) — push/
  ActivityKit-driven rather than rendered through our pipeline today; needs an
  iOS target plus an ActivityKit timeline adapter. (Currently deferred by
  design, see "Live Activities — deferred" above.)
- **Control Center / Action Button / Lock Screen controls** (`ControlWidget`,
  iOS 18 / watchOS 11) — our published control metadata (`reactControlMetadata`)
  already matches the shape; needs a `ControlWidget` host to render it.

**Strategy — watch-first.** Ship the watch (app + complication) to production
first: it's the hardest target and it's what this project *is*. The
widget-everywhere surfaces are the deliberate post-launch expansion — and
they're precisely what makes **ARCH-10 Phase B** (one interpreter behind a
`RenderContext`) worth doing, because each new surface would otherwise fork the
render switch again. Today the watch widget surface is enough.

**Scoped plan for the iOS widget host (DEFERRED — much later; watch is the focus
now).** A 2026-07-05 scoping pass mapped the real shape, recorded so it's ready
when we pick it up:

1. *Make the widget renderer compile + render for iOS.* Ungate the 5 widget-path
   files (`RNUI`, `WidgetNodeView`, `ReactTimeline`, `ReactWidgetButtonIntent`,
   `WidgetIntentRuntime`) from `#if os(watchOS)` to `#if os(watchOS) || os(iOS)`
   — but keep the genuinely watch-only bits under a tighter inner gate:
   **`RelevanceKit`** (Smart Stack relevance — no iOS equivalent), the
   `.accessoryCorner` family, and `@available(watchOS 11)` relevance. Add the
   iOS **system families** (`systemSmall/Medium/Large`) to `familyKey` and the
   JS widget family names. Verify: `xcodebuild build -destination
   'generic/platform=iOS Simulator'` green.
2. *A real iOS demo widget extension* (iOS app + widget target using the
   renderer) + the Expo/apple-targets plugin scaffolding → build+run on the iOS
   simulator.
3. *Phase B* — with iOS-widget as the 3rd interpreter target, unify via the
   `RenderContext` composition (see the Phase B note above).

The interpreter is mostly cross-platform SwiftUI/WidgetKit already; the real work
is separating the RelevanceKit/accessory-only pieces and the iOS family model,
plus a host app + plugin scaffolding.

## Re-prioritized "what's next"

1. **macOS build green** (gate — unchanged). Now also gates double-tap,
   on-device AI, and the inspector's on-watch side.
2. **HealthKit depth** — market demand keeps it the top *feature*. Note what
   is actually bound today: heart rate (a hidden `.other` workout session used
   purely as an HR pump, never saved), motion, gyroscope, location — using
   `HKWorkoutSession`/`HKLiveWorkoutDataSource`/`CMMotionManager`, all watchOS
   2.0–5.0 APIs, **no watchOS 26 API at all**. The gap is the reads and the
   controls: steps, energy, sleep, and real workout control (watch side of the
   existing streams done; verify on-device).
3. **Foundation Models streaming + structured output** — high-leverage now
   that the synchronous path ships; reuses the push channel.
4. **Cross-platform core extraction** (→ tvOS) — the strategic bet.
5. **`Map` primitive** + Smart Stack POI signals — ride the new APIs.
6. Then: OTA channel hardening, tree-diff (still measure-first).

Done since the last pass: **React Compiler** (build), **DevTools** (remote
inspector), **double-tap** (`primaryAction`). **On-device AI** (`generateText`)
is implemented but blocked (CX-002, [status.md](./status.md)). **Suspense**
investigated and deliberately not adopted (see above).

---

# Packaging (consumer feedback — see docs/consumer-feedback.md)

Acted on the ctrl-a-remote feedback ("a framework wearing a source folder's
clothes"). Shipped:

- **Consumable package** — `exports` (`.`, `./build`, `./testing`), `types`,
  `files`, and `peerDependencies` for react / react-reconciler. The renderer is
  now a real dependency, not a relative source reach-in.
- **pnpm workspace** rooted at this project (`js` + `examples/*` + `app`).
  `workspace:*` gives every consumer one React instance automatically — the
  alias / nodePaths / tsconfig-paths glue is gone. CI installs once with pnpm.
- **Exported build preset** — `react-watchos/build`
  (`watchBuildOptions`), so the QuickJS-correct esbuild config isn't copied.
- **Exported testing helpers** — `react-watchos/testing`
  (`findByType`, `findByText`).
- **Typed host surface** — `getHost()` + `QuickJSHostGlobal` exported, with a
  native-capability recipe (`docs/extending.md`).
- **Commit-model + serialization docs** (`docs/updates.md`).
- **Visible wire version** — `WIRE_VERSION` is codegen'd into TS *and* Swift
  (`RNWire.version`); the watch runtime raises a loud `runtimeError` on a
  renderer-vs-runtime `tree.v` mismatch instead of mis-decoding silently.
- **Two examples** — `examples/minimal-watch-app` (smallest consumer) and
  `examples/expo-watch-app` (Expo iPhone app + watch target). Both verified on
  Linux via `workspace:*`.

**SwiftPM host package — shipped.** The Swift host is now the `swift/` SwiftPM
package, so a consumer's watch target depends on it instead of copying ~2k
lines + the vendored C. Targets:

- `CQuickJS` — quickjs-ng as a Clang module (replaces the bridging header).
- `ReactWatchCore` — the codegen'd wire models (one `public` module; the watch
  + widget `WireModel`s are unified, no more duplicated `JSONValue`/`RNNode`).
- `ReactWatchRuntime` — the QuickJS embedding (`JSRuntime`).
- `ReactWatchHost` — the SwiftUI interpreter + bridges + `public
  ReactWatchRootView(appGroupId:)`.

The first three are **Foundation/C only and build on Linux** (CI `swift build`
+ the contract tests now decode through `ReactWatchCore`); making `JSRuntime`
Linux-buildable even caught real latent bugs (`JS_IsException` returns `Bool`
in quickjs-ng, so the never-compiled `!= 0` checks were wrong). `ReactWatchHost`
(SwiftUI) and the Expo/apple-targets local-SPM wiring remain the macOS gate.

**SPM auto-wiring — done (best-effort).** `with-react-watch-package.js` now
writes the `XCLocalSwiftPackageReference` + `XCSwiftPackageProductDependency` +
build-file objects into the apple-targets watch/widget targets during
`expo prebuild` (apple-targets/node-xcode have no local-package API, so it
edits the pbxproj directly). It's idempotent and wrapped so it can't fail
prebuild; the manual Xcode step remains the documented fallback. The pbxproj
logic is unit-smoke-tested on Linux, but Xcode acceptance is the macOS gate.

**Package polish — done.** The contract tests are now a `swift test` target in
the package (the separate `swift-tests/` package is gone); the widget's second
QuickJS embedding was unified onto `ReactWatchRuntime.JSRuntime` (one engine
embedding, ~200 fewer lines, no duplicated host); and `ReactWatchConfig`'s
`nonisolated(unsafe)` global is replaced by an injected, `Sendable`
`SharedWidgetStore` (no global mutable state).

**Shrinking the macOS-unverified surface.** Pure logic that used to ride along
inside the SwiftUI host (only compilable on a Mac) is being pulled into a
Foundation-only `ReactWatchSupport` target that builds and `swift test`s on
Linux: `OptimisticStore` (optimistic-control bookkeeping + seq-ack),
`NotificationPlan` (the `at`/`afterMs` trigger math + past-time clamp), and
`FetchPlan`/`FetchResponse` (request → `URLRequest` parsing + the
status/statusText/headers response shape), each unit-tested. The host is now a
thin SwiftUI shell over tested logic — fetch is just URLSession orchestration,
the haptic map is WatchKit-bound and can't move. Making this logic
Linux-buildable keeps catching real bugs: the wire models needed `Sendable`
(they cross the decode queue → main thread), and `URL(string:"")` is non-nil on
Linux (nil on Apple), so `FetchPlan` now requires an absolute URL with a scheme
instead of trusting `URL(string:)`.

**Distribution: source, not a compiled build (deliberate).** A compiled `lib/`
+ `prepare` step was tried and reverted: it broke non-workspace local consumers
(npm runs a linked package's `prepare` even with `ignore-scripts`, and it fails
without the renderer's dev deps; and the compiled export pointed at the
uncommitted `lib/`). This package is **bundle-only** — every consumer compiles
it into a QuickJS watch bundle — so `exports` point at `src/*.ts` and there's no
build step to run on install. Bundlers (esbuild/Metro/vite) transpile the
TypeScript directly; `file:`/`link:`/registry consumption all work build-free.
(Reported by ctrl-a-remote, docs/consumer-feedback.md.)

**Remaining packaging polish:** actually `npm publish` the JS package and
publish the SwiftPM package to a registry / remote SPM, so consumers get a
versioned dependency instead of a `file:`/`path:`/`workspace:*` reference — then
the plugin's local-package wiring becomes a normal `dependencies` entry.
(The publish path itself is rehearsed: a private end-to-end Verdaccio publish +
fresh-project install passed 2026-07-06 — see full-project-review-2026-07-04.md
§0. The real registry publish is what's still pending.)
