# Roadmap

Forward plan for `react-native-watchos`, organized into three parallel
tracks that touch mostly disjoint files. Derived from a reviewed feedback
pass; corrections from that review are folded in. Priorities: **P0** =
unblocks real apps, **P1** = strong value, **P2** = polish.

## Already shipped (don't redo)

- **Digital Crown** (`CrownRotation`, T1-P0) — done.
- **`setInterval`/`clearInterval` shim** (T2-P0) — done.
- **CI bundle-size budget** (`check:size`, T2-P1) — done.
- **WatchConnectivity bridge** (`sendToPhone`/`onPhoneMessage`, T3-P0) —
  watch side done; **iPhone-side WCSession still needs wiring in the Expo
  companion app**.
- **`fetch` shim over URLSession** (T3-P1) — done.
- **ErrorBoundary** + on-device error banner. Remaining: richer dev overlay
  with stack/source.
- **VoiceOver labels** (`A11yProps`). Remaining: Dynamic Type, reduce-motion.
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

Remaining: **DatePicker** + continuous drag-scrub (T1-P1), **tree-diff**
(T2-P1, **measure-first**), **sensors/HealthKit** (T3-P1).

**Live Activities — deferred (by design).** They're iOS ActivityKit
(authored on iOS, only *surfaced* on the watch Smart Stack), need a
separate iOS widget target we don't have, and are push/ActivityKit-driven
rather than rendered through our React pipeline — so they don't fit and
can't be verified here. The Smart Stack *ranking* (relevance scores) is
already implemented. Revisit only if a real app needs an iOS Live Activity.

All SwiftUI/CoreBluetooth code added across these passes is **unverified
until the macOS build runs green** — that's the gate.

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
| Tree diff / patch protocol | P1 | L | The scale-gated upgrade. **Measure first**: build a 200-row `List` benchmark and prove per-commit serialize+decode shows in a profile before building it. The no-op bailout is the cheap partial already in place; SwiftUI still re-diffs regardless, so the only win is wire+decode size. Highest effort, narrowest payoff. |
| Minified/bytecode shipped artifact + CI size budget | P1 | S | Ship minified (`build:min`, ~halves it) or `.qbc` for production; keep unminified default for readable on-watch traces. Add a CI byte-size budget check. |
| Richer dev error overlay | P2 | S | Build on the existing banner: stack frames, tap-to-dismiss already there; add source context in DEBUG. |

## Track 3 — Platform integration & connectivity

Owns the companion app, new `__host` methods, native-event streams.

| Item | Pri | Effort | Notes |
|---|---|---|---|
| **WatchConnectivity bridge** | P0 | M | The most-requested real-app gap; the Expo companion app exists for exactly this. Phone→watch via the existing `registerNativeListener`/`__pushNativeEvent` channel; watch→phone via a new `__host.sendToPhone`. Wire `WCSession` on both sides. Accept: a phone message updates watch UI live. |
| Networking (`fetch`) | P1 | M | A `fetch` shim backed by `URLSession` through a new async `__host` method. Promise-based → **depends on Track 2's async/`setInterval` work** for deterministic flush. |
| Sensors / HealthKit | P1 | M-L | Heart rate, motion, workout sessions as native-event streams on the push channel. HealthKit adds entitlement/privacy plumbing. Builds directly on `__pushNativeEvent`. |
| Dynamic Type + reduce-motion | P2 | S | Labels already done; add scaled fonts and motion-reduction honoring. |
| Live Activities / Smart Stack+ | P2 | M | Extends the existing widget timeline pipeline. |

## Sequencing & dependencies

- **`setInterval` shim (T2-P0) lands first** — it's the cheapest and it
  unblocks fetch (T3-P1) and timer-driven sensor streams (T3-P1).
- The three P0s (Crown, WatchConnectivity, setInterval) are otherwise
  independent and parallelizable across agents.
- **Hard gate:** every SwiftUI change is unverified until the macOS build
  (`.github/workflows/react-native-watchos-build.yml`) runs green. The
  Linux `swift-tests` only verify *wire decode* of new props, not the view.
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
   `swift-tests/`) so the prop decode is checked on Linux.

Wire-contract rules:

- **Adding node types or props keeps `v: 1`** — `RNNode.props` is open and
  unknown types degrade via the `default:` case, so additive changes are
  backward-compatible. Bumping `v` per primitive would make the Swift
  decoder reject valid trees.
- **Bump `v` only for breaking changes to the shared structs** (`RNNode`,
  `RNTree`, `Published*`), and do it through `js/codegen/schema.mjs` so both
  Swift models regenerate together. New *payload structs* (not node types)
  also go through the schema.
- Keep pure-Foundation Swift Linux-compilable so `swift-tests` covers the
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

## Re-prioritized "what's next"

1. **macOS build green** (gate — unchanged).
2. **Sensors/HealthKit** (was T3-P1) — promoted: watchOS 26's fitness APIs +
   market demand make it the top *feature*.
3. **React Compiler** in the build — cheap perf, verifiable here.
4. **Cross-platform core extraction** (→ tvOS) — the strategic bet.
5. **`Map` primitive** + Smart Stack POI signals — ride the new APIs.
6. Then: DatePicker, tree-diff (still measure-first), OTA channel.
