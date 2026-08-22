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

Also shipped: **DatePicker**, **onDrag** scrub (T1), **five sensor streams**
(T3-P1 — heart rate / motion / gyroscope / location / pedometer) plus
**HealthKit reads and real workout control** (2026-07-29),
**Map** primitive, **Smart Stack relevance** (per-entry ranking AND the
predictive `relevantContexts` clue union — the CX-017 "decoded-not-applied"
label went stale: the apply shipped with the 2026-07-28 wire reshape +
2026-08-06 watch-sim compile, verified 2026-08-22 down to WidgetKit really
calling `TimelineProvider.relevance()`, watchOS 11.0; the JS↔Swift clue
vocabularies are now guard-tested so a typo'd name can't silently never
surface a widget), **Liquid Glass** (`glass`), **OTA update channel**
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

## DX follow-ups from the first real consumer migration (2026-08-06)

Migrating ctrl-a-remote onto the published package surfaced three concrete
testing-DX gaps — each one forced the consumer to hand-roll internals.
**All three shipped** (`feat(js): public test harness` 050867f —
`js/src/testing.ts` exports `mountApp`/`resetApp`, `installInvokeHost` with
recorded `{method, payload}` calls and per-method result/reject handlers,
and `pushDeepLink`; this section predates that commit and is kept as the
record of why the harness exists). The one genuinely remaining debt — the
suite's own `installMockHost` still hand-rolling a SECOND invoke settle
wire — closed 2026-08-22: the mock now routes through the published
`installInvokeHost`, which grew the semantics the mock had invented
privately (a `"*"` wildcard handler, `undefined` resolving the void wire,
thrown `Error` → `INTERNAL` with the message kept), so consumers get what
our own tests exercise. Repo gotcha found on the way: `docs:api` run from a
LINKED git worktree silently drops every "Defined in" source link (typedoc
needs `.git` to be a directory) — regenerate from a normal checkout.
The original asks:

- **Ship an invoke-recording test host.** Consumers mock the invoke wire by
  hand (`__host.invoke(id, method, payloadJson)` + `__resolveInvoke` +
  `queueMicrotask`) to test anything BLE/health/connectivity. `testing`
  should export a `createInvokeHost()` that records `{method, payload}` and
  auto-settles (configurable result/reject per method).
- **Ship a navigation driver.** A NavigationLink press is confirmed by the
  native stack, so `dispatchEvent({event:"press"})` on a link returns
  `{handled:false}` — surprising, undocumented, and every consumer test ends
  up copying the deep-link push idiom from our own navigation suite. Export
  a `pushDeepLink(url)` helper (and document WHY link presses aren't
  test-dispatchable).
- **Auto-dispose between tests.** The single-root rule makes every consumer
  hit "runApp: a root is already mounted" in their second test. Export a
  `mountApp()` test helper that tracks and disposes the root (our own suite
  already has one — publish it).

Also owed from the same pass, ✅ **done 2026-08-21**: MIGRATIONS.md (repo
root, deliberately not in the npm tarball — mirrors how CHANGELOG.md ships
nowhere; release reading happens on the repo). Every entry was verified
against the current source before landing, which killed three false claims
the changelog alone would have produced — a violating widget does NOT throw
out of `publishWidgets()` (it is caught per kind and logged), the external
source map changes no shipped byte, and the knip de-exports were
unreachable through the exports map, so none of them are breaks. Covers
0.2.0 → 0.6.0 plus the workspace-era → 0.1.x section (ARCH-09 lazy-mount
consequences, ARCH-12 channel split) for consumers on pre-npm code.

## Graduation-review follow-ups (2026-08-06, adversarially verified)

- **Engine upgrade: quickjs-ng v0.15.1 → v0.16.1 — DONE 2026-08-06.** The
  owner explicitly waived the 7-day cooldown for this bugfix release (v0.16.0
  Jul 31 carried memory-safety fixes — coroutine use-after-free,
  detached-ArrayBuffer double-free — and v0.16.1 Aug 4 fixed 0.16.0). Vendored
  via `tools/vendor-quickjs/run.sh v0.16.1` (tarball SHA verified), qjs_sources
  set unchanged upstream (checked against the 0.16.1 CMakeLists). Gates all
  green: embed-smoke (boot 30.7 ms, heap 2.1 MB, .qbc path incl. the 0.16.1
  bytecode), vendor-integrity 2/2, JS 646/646, macOS `swift test` 375/375,
  watch-sim `xcodebuild test`.

Publish steps (this IS the standalone repo now — extraction happened; status
as of 2026-08-06):

- ✅ **DONE — release-please config/manifest keys** re-keyed from
  `projects/react-native-watchos/js` to `js` in this repo (2026-08-06);
  `release-please-config.json` / `.release-please-manifest.json` both use the
  short key.
- ✅ **DONE — publish workflow** (`publishConfig.provenance` requires
  publishing from GitHub Actions with `id-token: write`): landed 2026-08-06 as
  `release.yml` + `release-please.yml`; the trusted-publisher attachment was
  made after the bootstrap publish and 0.1.0 through 0.5.0 are on npm. The two
  files merged into a single `release.yml` on 2026-08-20 — see the closed
  follow-up below for why.
- ✅ **DONE — blob strip**: history rewritten 2026-08-06; zero
  `app/targets/watch/assets/bundle.js` objects remain in the repo's history
  (`git rev-list --all --objects` finds none).

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
| Focus management | P2 → **shipped 2026-08-22** | M | Multi-Crown screens unblocked: `focused?: boolean` (declarative, EDGE-TRIGGERED claim — applies on committed change and on appearance, `false` resigns) + `onFocusChange` on `CrownRotation`, bound to SwiftUI `@FocusState`/`.focused(_:)` — the screen's React state IS the coordinator, because SwiftUI's single-owner invariant already arbitrates the hardware. Prior-art surveyed before design (react-native-tvos's boolean claim borrowed; its `nextFocus*` spatial traversal rejected — watchOS has no D-pad; imperative `ref.focus()` rejected — no command channel, and the edge-triggered prop IS the command with replay-on-remount under ARCH-09 lazy nav). Every symbol verified against Apple docs JSON (all ≤ watchOS 10 floor → no `@available` gates). Wire stays v1 (additive props). Design record: [design-focus-management.md](./design-focus-management.md), §5 lists what only a device can prove (actual Crown hardware handoff, tap-to-steal event pair, resign-with-no-successor) — the standing macOS-build gate. Incidental fix en route: `docs:api` from a linked git worktree silently dropped every source link; typedoc now pins `disableGit`/`basePath`, output byte-stable across checkouts. |

## Track 2 — Runtime, rendering & performance

Owns `shims.ts`, `renderer.ts`, `scripts/`, CI.

| Item | Pri | Effort | Notes |
|---|---|---|---|
| **`setInterval` shim** | P0 | S | The confirmed bug: `setInterval`/`clearInterval` are undefined in QuickJS, so an interval-driven update throws. Add them on top of the existing `setTimeout`→`__host.setTimer` bridge (re-arm on fire). *Async `setState` already commits via the scheduler's `setTimeout` hop* — this is the missing piece, not a scheduler redesign. Document the scheduler integration. Accept: an interval counter commits with no tap. **Land first** — unblocks Track 3's fetch/sensors. |
| Tree diff / patch protocol | P1→**dropped** | L | **Measured (`treediff.bench`): 200 rows = ~13 KB, ~0.04 ms/serialize.** In-process serialize+decode is negligible and SwiftUI re-diffs the decoded tree regardless, so a patch protocol is **not warranted** at this scale — confirmed, not built. The no-op bailout is the cheap partial already in place. Revisit only if a profile on a real device shows commit cost (e.g. thousands of nodes). |
| Minified/bytecode shipped artifact + CI size budget | P1 → **shipped** (2026-08-20) | S | The CI byte-size budget landed earlier (`check:size`, ci.yml). **The 2026-08-20 reversal:** this row used to say *“keep unminified default for readable on-watch traces”* — that trade was never measured, and measuring it inverted the answer. Minified vs not, on this repo's own bundles: app **605 KB → 195 KB (-68%)**, widget **~501 KB → ~150 KB (-70%)**, and a reporting consumer's widget **1065 KB → 476 KB (-55%)**. Through `tools/embed-smoke/run.sh` (vendored quickjs-ng + the reference C host, the exact embedding sequence `JSRuntime.swift` uses) the minified bundle also holds a **1.4 MB QuickJS heap against 2.1 MB** and boots in **31.7 ms (parse 24.5 + eval 7.3) against 44.1 ms (36.1 + 8.0)** — a third less heap on the platform where memory is the first wall, and it still mounts, dispatches and compiles to `.qbc`. The “readable traces” being bought were **one line of one frame**: React's prod frame builder uses `fn.displayName \|\| fn.name`, so USER component frames read `at t` — but HOST frames (`at VStack`, `at Text`) are string literals in `components.ts`, the diagnostics ring is minification-immune, and nothing in the repo parses `error.stack` or reads `Function.prototype.name`. **So the SHIP path flipped:** `buildBundles` defaults `minify: true` and the `react-watchos build` CLI minifies with a `--no-minify` escape, while `watchBuildOptions` stays unminified and `react-watchos dev` pins `minify: false` at its call site — the dev loop is where named frames are the point. ⚠️ **Landmine for anyone tempted to flip the last one:** the repo's OWN `pnpm build` (`js/scripts/config.ts`) deliberately stays unminified, because `test/react-compiler.test.ts` asserts the emitted bundle contains `"react/compiler-runtime"` — present at 620,055 B, gone at 199,674 B. `build:min` is the minified in-repo artifact. |
| Native compilation as a PR gate (CX-013 reversed) | P1 → **shipped** (2026-08-20) | S | CX-013 skipped this in 2026-06 — "you don't rely on Actions for native; stays manual" — when the only native surface was a SwiftUI shell. It is now the watchOS half of the health bridge, the SwiftUI host and the widget infra, every one of which compiles to an EMPTY module off-watchOS (NF-30), so the `swift test` that runs on every push proves nothing about them. What the old rule cost is on the record: the 2026-08-07 → 08-10 run of red nightlies, found days after the commit that caused it. `build.yml` now runs on `pull_request` AND on push to main, path-filtered to `js/swift/**`, `js/plugin/**`, `app/**` and the workflow itself — a docs or renderer change still spins up no macOS runner, and `concurrency` cancels superseded runs on the same PR. The three jobs (`swift-lint`, `watchos-tests`, `build`) are marked **required** in branch protection; that toggle is repo settings, not a file in this tree, so it is the one half of this row a checkout cannot prove. |
| Richer dev error overlay | P2 | S | **JS layer shipped:** ErrorBoundary forwards `componentStack`; the remote inspector rings errors (message/stack/componentStack + `console.error` tee) into an ERRORS panel. Remaining: surface it in the native on-device banner (macOS-build-gated). |
| **JSRuntime owning-queue confinement (M1)** | P1 → **shipped** | M | The engine's contract is "one thread per runtime": the app runtime lives on main, but WIDGET runtimes are created/evaluated/discarded on WidgetKit provider threads while the default timer path delivered `__fireTimer` on main. **Shipped (full fix):** `JSRuntime` captures an owning serial queue at init (app = main; widget = its own private queue; the OTA validator/compiler pass theirs), every entry routes through it structurally — inline when already on it, `sync` hop otherwise — timers fire on it, and the old DEBUG main-thread assertions are gone (confinement is now guaranteed, not policed). Intent-mode widget JS still refuses timers loudly, but because they are *useless* in a discard-after-return pass, not unsafe. |
| **Interpreter per-prop parity (M6 interim)** | P1 → **shipped** (interim; ARCH-10 still pending before a 2nd platform) | M | The two SwiftUI interpreters share parsing (RNStyle/RNFormat) and a case-presence contract test, but per-prop behavior inside each case is still parity-by-comment (applyLayout chain, color tables, alignment mappers, chart builders). Until the ARCH-10 single-interpreter refactor (one NodeView parameterized by a RenderContext — required before any second platform target), add the 2026-07-04 review's interim ask: a schema-generated per-prop golden parity test. |
| Lazy navigation (native-backed) | P2 → **shipped** (ARCH-09, 2026-07-16) | M | **Option B, built.** The eager-mount root cause (the native push was *optimistic* — `RoutedNavigationStack` ran its `navigationDestination` a bridge hop before JS committed) is gone: event dispatch now returns a structured `{handled, accepted, reason}` verdict, the stack **confirms with JS before animating** (a declined/failed proposal animates nothing; pops stay always-accepted), and `NavigationRoute` mounts children only for the root + the active path's winners (memoized `StackWinners`), so inactive routes are neither mounted nor serialized. BREAKING: screen-local state drops on pop; inactive-screen effects must use `useFocusEffect` (already the documented pattern). Measured on the vendored-engine bench: launch tree **152 → 48 nodes / 13.4 → 4.1 KB**, perDispatch **1.32 → ~0.52 ms**. JS + engine verified (nav suite 27/27, qjs-smoke lazy contract, swift test 215); the Swift halves are watchOS-only — on-device transition-latency validation still owed. |

## Track 3 — Platform integration & connectivity

Owns the companion app, new `__host` methods, native-event streams.

| Item | Pri | Effort | Notes |
|---|---|---|---|
| **WatchConnectivity bridge** | P0 → **wired** | M | Both sides in place: phone→watch via `registerNativeListener`/`__pushNativeEvent`, watch→phone via `sendToPhone` (invoke channel), and the companion app's `react-native-watch-connectivity` listener replies so the watch promise settles. Accept criterion (a phone message updates watch UI live) still needs a paired sim/device run — ③ in status.md. **Background channels shipped too (ARCH-12, 2026-07-16):** outbound `updateApplicationContext` (latest-wins state) / `transferUserInfo` (FIFO queue surviving suspension) over invoke; inbound events split by delivery semantics with `onApplicationContext`/`onUserInfo` (BREAKING: phone-pushed context no longer arrives on `onPhoneMessage`). JS-verified (connectivity 7/7); the watch-only delegates await the next Xcode build. **File channel + session state shipped 2026-07-29 (PLATFORM-DATA item 4):** `transferFile` (resolves once QUEUED — Apple's transfer is throttled and can complete in a later launch), an inbound inbox under Application Support with the move done synchronously inside the delegate, and `getConnectivityState`/`onConnectivityState` as **observability, not a send gate**. 🔴 The file half is **unverifiable on a simulator** at all (Apple states the Simulator supports neither `transferFile` nor `session(_:didReceive:)`) — paired physical devices only. |
| Networking (`fetch`) | P1 | M | A `fetch` shim backed by `URLSession` through a new async `__host` method. Promise-based → **depends on Track 2's async/`setInterval` work** for deterministic flush. |
| Sensors / HealthKit | P1 → **shipped (device-verify pending)** | M-L | **Streams:** heart rate, motion, gyroscope, location, and (2026-07-29) pedometer on the push channel. **Reads (2026-07-29, feature `health`):** steps, active energy, walking/running distance, heart rate, SpO2 and sleep stages via the `HK*QueryDescriptor` family. **Vocabulary widened 2026-08-20:** `restingHeartRate` (`"count/min"`) and HRV SDNN (`"ms"` — read in seconds it reports 0.045 where the Health app shows 45) join as the sixth and seventh quantity types; both are DISCRETE, so `sum` is refused, and both are watchOS 4.0 identifiers, so the family stays gate-free. **Widened again the same day to fourteen:** the activity set gains `appleExerciseTime` + `appleStandTime` (`"min"`), `basalEnergyBurned` (`"kcal"`) and `flightsClimbed` (`"count"`) — all CUMULATIVE — and the cardio set gains `respiratoryRate` + `walkingHeartRateAverage` (`"count/min"`) and `vo2Max` (`"ml/kg/min"`, Apple's own spelling, and the compound unit where a slipped prefix reports 0.045 against an estimated range Apple gives as 14-60) — all DISCRETE. Re-verified per type against Apple's docs JSON: watchOS `introducedAt` tops out at 6.0 (`appleStandTime`), none beta or deprecated, so the family is still `@available`-free. **Workout control (2026-07-29, feature `workouts`):** start/pause/resume/end with a real saved `HKWorkout`, live `workout.metrics`, and an optional route. The single-session hazard is what the design turns on — watchOS runs one `HKWorkoutSession` per process, so `WorkoutSessionOwner` owns the only one and the hidden HR pump takes a claim on it rather than competing. **Follow-up wave, same day:** `healthBuckets` (`queryHealthDailyStatistics`, one query per week chart instead of seven), `workoutRecovery` (`recoverActiveWorkoutSession` for the crash case) and `pumpKillIsInvisible` (delegate publishing by session identity) are all taken. **WorkoutKit plans (2026-07-29, feature `workoutPlans`):** the `workoutPlans` follow-up taken the same day — compose a `CustomWorkout`/`SingleGoalWorkout`/`PacerWorkout`, hand it to Apple's Workout app (`openInWorkoutApp()`), and schedule/list/remove it (`WorkoutScheduler`). Its own authorization unit, with a REAL verdict (unlike HealthKit reads). The design turns on one finding: Apple's scheduler mutators are non-throwing and return nothing, so **every mutation is verified by read-back** and a scheduler that stored nothing rejects `UNAVAILABLE` saying so. **The 2026-08-06 sim spike answered the open question, inverting the guess: watch-side scheduling WORKS on-sim** (auth sheet resolves `authorized`, schedule + read-back persists, 41 consecutive schedules accepted, `removeAllWorkouts` read-back-verified — all under the `healthkit`-less sim entitlement set), while **`openInWorkoutApp()` is the half that fails on the sim** and stays device-③. See [design-workout-plans.md](./design-workout-plans.md) §6 RESULTS and the status.md WorkoutKit row. **Saved workout HISTORY (2026-08-20, `queryWorkoutHistory`):** the second gap the maintainer named — the package could start a workout and read live metrics, but nothing could read what was SAVED, so "your last five runs" was unrenderable. `HKSampleQueryDescriptor` + `HKSamplePredicate.workout(_:)` (generic over `HKWorkout`, so no cast), newest first, window + cap; energy and distance via `HKWorkout.statistics(for:)` (watchOS 9.0) rather than the deprecated `totalEnergyBurned`/`totalDistance`, which also cannot tell "no samples" from zero — so both cross the wire as `number | null`. Filed under `health`, NOT `workouts`: recording a workout and being shown every workout the user has are different grants (ARCH-07), and reading the second under the first is precisely the mismatch that split exists to prevent. Its read type (`HKObjectType.workoutType()`) rides a new `workoutHistory` flag on `requestHealthAuthorization` — no new entitlement, no new Info.plist key, but a new sheet ROW, so the plugin's default read sentence names saved workouts. Multisport `HKWorkoutActivity` segments and the full `allStatistics` map stay deferred; the shape is what a LIST row renders (id, start/end, `durationMs` excluding paused time, optional activityType, nullable energy + distance), leaving a detail-view read for later. **Activity RINGS with their goals (2026-08-20, `queryActivitySummaries`):** the top item on the maintainer's list, and the one no quantity type could ever have covered — HealthKit exposes a goal on `HKActivitySummary` and nowhere else, so a ring (a value measured *against* a goal) was unbuildable from this package. `HKActivitySummaryQueryDescriptor` (watchOS 8.5), one row per day: move (energy *and* time, with `activityMoveMode` saying which is the ring — under-18 accounts close a minutes ring), exercise, stand, each with its goal. The request is a range of calendar DAYS (`"YYYY-MM-DD"`, inclusive, ≤1000), not a millisecond window: HealthKit matches summaries by `DateComponents` identifying a day *as the user perceives it*, and those components must carry a `calendar` or the query matches nothing SILENTLY — so they are built once in `ReactWatchSupport` (`ActivityDay`), Linux-proven, and the watchOS bridge builds none. The watchOS 9.0 goals are optional and ride as `null`, never as a substituted default; `appleExerciseTimeGoal`/`appleStandHoursGoal` (deprecated at 27.0) and `isPaused` (11.0, above the floor) stay out. Its read type (`HKObjectType.activitySummaryType()`) rides a new `activitySummaries` flag on `requestHealthAuthorization` — one sheet row, no new entitlement, no new Info.plist key. **LIVE FOREGROUND UPDATES (2026-08-20, `startHealthUpdates`):** the last of the two gaps the maintainer named, and the first SUBSCRIPTION in this package — an `HKAnchoredObjectQueryDescriptor` (watchOS 8.5) per quantity type, so a screen showing today's steps or the current heart rate updates itself as samples land instead of polling. Delivery is the name-routed event channel (`health.samples.<type>`); START and STOP are `invoke`, because a HealthKit start is fallible and the `sensor` direct method — the only other start here — has no reply path at all, which is the wart this deliberately does not repeat. NEW samples only: `anchor: nil` returns everything MATCHING, so the bound is the predicate (an open-ended window from the subscribe instant, whose default overlap rule keeps the late-saved step sample a live screen exists to show), and history stays `queryHealthSamples`'. Pushes are floored at `minIntervalMs` (default 1000, ceiling 60000) by WAITING rather than dropping — a sample stream is edge-triggered, unlike the level-state `workout.metrics` next door. Foreground-only by design (no background-delivery entitlement: that is still `healthBackground`), stopped in `tearDownGeneration` before the runtime is freed because the push path has no generation guard, and guarded through the authorization window by a per-type epoch — a want-flag alone lets StrictMode's stop-then-restart arm an orphan query. Deferred with it: `healthUpdateDeletions` and `healthUpdateVocabulary` (sleep/rings are not quantity samples). Remaining: **③ device-only** (the sim build is deliberately signed without the `healthkit` entitlement), plus the still-deferred follow-ups — `workoutReloadSurvival` (deliberate: a reload still ends + saves), `healthBackground` (`HKObserverQuery`), `healthHourlyBuckets`, `activityRingsPaused` (`isPaused` is watchOS 11.0), and the five WorkoutKit deferrals (`workoutPlanStepNames`, `workoutPlanSwimBikeRun`, `workoutPlanMarkComplete`, `workoutPlanSupportQuery`, `workoutPlanPowerMetric`). See [design-health-package.md](./design-health-package.md). |
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
(CX-002, [status.md](./status.md) — re-verified 2026-08-22: the gate→27,
`maxTokens` and capability-query fix is in the tree via the import commit;
only the Xcode-27 device verify remains). Extensions, all behind the same
`HostBridge` seam:

- **Streaming tokens** — ✅ **shipped 2026-08-22**: cumulative-snapshot
  `onPartial` on `generateText` (Apple's own stream shape — renderable and
  self-healing, vs delta streams), bridge-coalesced with a `partialIntervalMs`
  floor, `AbortSignal` cancellation that stops the model natively, teardown
  cancelling every live generation under the sensor-stream epoch rule.
- **Structured output** — ✅ **shipped 2026-08-22**: `generateObject(schema)`
  over a typed-CLOSED JSON-Schema subset (deliberately not JSONSchema7 — it
  would type-check `$ref`/`oneOf` the wire must reject; no Zod — bundle
  size) mapped to `DynamicGenerationSchema`; malformed/refused generations
  reject with a closed 12-code `AIError` union, never garbage. Design
  record: [design-ai-streaming-structured-output.md](./design-ai-streaming-structured-output.md).
  Honest boundary: the `canImport(FoundationModels)` block has NEVER
  compiled (needs Xcode 27) — Linux pins the wire, plan, schema subset and
  JS semantics; the design note lists the exact spellings at risk.
- **Tool calling** — ✅ **shipped 2026-08-22**: `generateText`'s `tools`
  record (name-keyed, argument schemas reuse the AISchema subset — one
  vocabulary) round-trips JS-IMPLEMENTED tools: FM's own async `Tool.call`
  makes the resume implicit, the parked `CheckedContinuation` releases its
  thread and the push channel carries `ai.toolCall` out / `toolResult`
  back, so nothing ever blocks the main actor (the DAP deadlock class is
  structurally absent — analysed in the design record). Cancellation fails
  parked calls BEFORE cancelling the task, so FM is never left suspended;
  `TOOL_FAILED` joins the closed error union; `generateObject` deliberately
  takes no tools. Same honest boundary as the rest of §6: the
  `canImport(FoundationModels)` block is Xcode-27-owed.
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
  (`ReactWidgetButtonIntent`, watchOS 11+). Smart Stack relevance is fully
  in — ranking AND predictive `relevantContexts` (the stale CX-017 note was
  corrected 2026-08-22; see status.md row 53). Known vocabulary gap recorded
  the same day: `appleMoveTime` is absent from the health read set, so the
  `activityRingsIncomplete` fitness clue's documented requirement cannot be
  fully honoured — adding it touches schema + unit table + bridge arms +
  the plugin's sheet string.

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

## Open follow-ups (recorded 2026-08-12, after the defect backlog emptied)

Nothing here is broken today; each is a gap we named while doing something
else and chose not to chase in the same pass. Roughly in the order they
earn their keep.

- ✅ **DONE — IPv6 loopback is a real OTA dev host** (2026-08-22). The host
  regex matched `[^/:?#]*`, stopped at the first colon and handed
  `isPrivateHost` the bare string `"["` — so the old `host === "[::1]"`
  branch could never fire. Now: the URL regex takes a bracketed host as a
  unit, a real hextet parser accepts exactly `::1` (ULA `fc00::/7` and
  link-local `fe80::/10` refused by explicit guards ahead of the loopback
  compare), Swift's `UpdateURLPolicy` mirrors it byte-for-byte, and both
  sides are pinned with the same matrix including the bare-`[` regression.
- ✅ **DONE — `pendingRejections` holds an owning retain** (2026-08-22). Each
  parked entry now `JS_DupValue`s its promise for exactly its map lifetime,
  freed on every exit path (retraction, drain report, displacement,
  shutdown). No shim change needed — `JS_DupValue` is exported. The bug was
  real: an address-reuse test ate a genuine report on the unfixed code
  (verified red before fixing), and the suite's engine-leak assertions hold
  the refcount balance.
- **The `watchConnectivity.file` park/replay path has no test** — 
  ✅ **verdict recorded 2026-08-22: not testable off-watchOS, no code bent.**
  The whole path is `#if os(watchOS)` (the target isn't even in the Linux
  package graph), and even a Mac-side seam is blocked by WatchConnectivity
  itself: `WCSessionFile`/`WCSessionFileTransfer` have no public
  initializers, so the park and transferLock delegate entries cannot be
  driven without refactoring them into internal methods over constructible
  types plus a `WCSessionProviding` seam. What IS extractable was already
  pinned pre-verdict (`ParkedQueue` in ReactWatchSupport: arrival-order
  drain, release-only-on-drain). Revisit only alongside that Mac refactor.
- ✅ **DONE — `.qbc` content hash has a three-way parity test** (2026-08-22).
  One hand-authored vector file
  (`js/swift/Tests/ReactWatchTests/Fixtures/content-hash-vectors.json`; 5
  vectors including a brute-forced leading-zero-nibble hash that makes the
  "no leading zeros" format rule load-bearing) asserted from Node, from the
  REAL `qjs-compile [out.hash]` production path (object-cache pattern shared
  with qbc-symbolication via `js/test/qjs-tools.ts`), and from Swift's
  ContentHash — silent drift now fails three suites instead of presenting
  as "every boot falls back to parsing source".
- ✅ **DONE — publishing no longer needs a manual dispatch** (2026-08-20).
  release-please creates the GitHub Release with the default `GITHUB_TOKEN`,
  and GitHub does not start workflow runs from events raised by that token, so
  `release: published` never reached `release.yml` once — 0.2.0, 0.2.1, 0.3.0,
  0.4.0 and 0.5.0 were each published by hand. `release-please.yml` is now
  folded into `release.yml` as job 1, and the npm publish is job 2 of the SAME
  run, gated on the action's own `js--release_created` output with a
  manifest-version-vs-npm check as the safety net. A PAT or GitHub App token
  was the other way to close the loop; one run needs neither. Note this
  prevents the NEXT stranded release — it did not recover 0.5.0, which was
  already dispatched by hand and is npm's `latest`.
- **Two upstream bugs carried as local patches** — ✅ **drafts written
  2026-08-22, filing owed to the maintainer** (`docs/upstream-issues/`). The
  measurement pass corrected this row's own claim: `numericLiteral(-27)` is
  ACCEPTED by every @babel/types 7.x publish (7.27.1/7.28.0/7.29.7 measured —
  the validator is compiled out) and throws only on **8.0.0**, so the worklets
  draft is framed "crashes on any Babel 8 toolchain" with a verified e2e repro
  and a one-line `valueToNode(-27)` fix; file it on the reanimated monorepo
  (the worklets repo redirects). The apple-targets `find(byName) ?? targets[0]`
  fallback is confirmed byte-identical in published 4.0.7 and 5.0.0.
- ✅ **DONE — cooldown-cleared bumps taken** (2026-08-22): expo 57.0.13,
  @expo/config-plugins 57.0.8, esbuild 0.28.2, biome 2.5.8, each after its
  7-day `minimumReleaseAge` soak; @bacons/apple-targets 4.0.7 → 5.0.0 rode
  along via `pnpm dedupe`. Held on purpose: expo 57.0.14/.15 and biome
  2.5.9/.10 (soak clears 08-24 → 08-28), react 19.2.8 and RN 0.87 (outside
  SDK 57's own template pairing — not housekeeping), TS 7 / @types/node 26
  (majors). FlareLog's family is that repo's own wave, not ours.
- **Downstream consumers are a minor behind.** `ctrl-a-remote` and `flarelog`
  pin `react-watchos ^0.3.0`, and 0.x treats a breaking change as a minor, so
  neither picks up 0.4.0 on its own. Bump both and re-run their suites.

## Re-prioritized "what's next"

1. **macOS build green** (gate — unchanged). Now also gates double-tap,
   on-device AI, and the inspector's on-watch side.
2. **HealthKit depth** — **delivered 2026-07-29** (reads + real workout
   control + pedometer; see [design-health-package.md](./design-health-package.md)),
   and now blocked on exactly one thing: a **device** pass. Every symbol used
   is watchOS 10.0 or below — **no watchOS 26 API at all**, and not one
   `@available` gate in the whole package — but the simulator run script signs
   *minus* the `healthkit` entitlement on purpose, so no authorization sheet,
   no real sample, no saved workout and no route has been exercised. That, not
   more API surface, is what "HealthKit depth" now needs.
3. **Foundation Models streaming + structured output** — high-leverage now
   that the synchronous path ships; reuses the push channel.
4. **Cross-platform core extraction** (→ tvOS) — the strategic bet.
5. **`Map` primitive** + Smart Stack POI signals — ride the new APIs.
6. Then: OTA channel hardening. (Tree-diff got its measure-first answer
   2026-08-22 — **declined**, full numbers in
   [perf-tree-diff.md](./perf-tree-diff.md): the one ~10× win needs a
   ~600-node covered stack streaming at 10–20 Hz, ~6× past the worst real
   screen and exactly where the ARCH-13 tripwires already point; nav swaps
   produce all-new ids so patch ≈ full tree, and wire bytes are
   intra-process anyway. Prototype + cross-language fixtures kept so a
   future adoption is days. Cheaper levers it ranked: coalescing, tree
   size, and a MEASURED 2× wire-neutral decoder swap — ✅ **taken
   2026-08-22**: `RNTree(wireJSON:)` builds the wire models straight from
   JSONSerialization (10.1 → 5.5 ms on the 595-node bench, 1.9×; small
   commits 2.1×), number semantics pinned decoder-vs-decoder across every
   fixture plus ~20 adversarial payloads, Codable kept for the cold paths
   that really use it. Honest premise correction recorded: the decode runs
   on the host's decodeQueue, not main — the win is per-commit CPU/battery
   at streaming rates, not frame budget. Bonus trap measured and dodged: on
   corelibs an early `is NSNull` on the root flips the container into
   NSObject representation and every string cast then pays an eager bridge
   copy — a naive port ships at 1.0×. The pass also
   caught a real bug, fixed same day: covered dynamic routes lost their
   params and serialized their no-param branch into the held tree.)

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

## Build pipeline & engine currency (recorded 2026-08-21)

Context: 2026-08-20/21 shipped minification-by-default, external source maps on
by default, and the vendored-engine gate. A review pass over that work (a
14-phase plan a consumer generated with ChatGPT, reconciled against the actual
tree) surfaced one real defect and a queue of measurable questions. Recorded
here so the queue survives the session that found it.

| Item | Priority | Size | Notes |
|---|---|---|---|
| **Production `.qbc` carries no stack positions** | **P1 → shipped 2026-08-21** | S | **Fixed and proven end to end.** `tools/qjs-compile` now writes `BYTECODE\|STRIP_SOURCE` (debug tables kept, source text still stripped): production frames go from `at d0 (<null>:0:1)` to real `file:line:column`, byte-identical to the source-parsed path. The acceptance test is the real chain, not a synthetic lookup: `js/test/qbc-symbolication.test.ts` builds a known `.tsx` through the real preset, compiles it with the real `qjs-compile`, executes the BYTECODE in the vendored engine via a minimal `JS_ReadObject`+`JS_EvalFunction` host (`tools/qjs-compile/qbc-stack.c`), captures the real `Error.stack` and resolves it through the shipped `symbolicate-core` back to the fixture's line/column/name — and restoring `STRIP_DEBUG` fails 5 of its 7 cases, headed by the `<null>` assertion. Measured cost (re-verified at ship time): +45.4 KB `.qbc` (204,979 → 250,361 B on the minified app), +36 KB QuickJS heap, +0.07 ms `JS_ReadObject`; retaining source would add +652 KB for identical stacks, so `STRIP_SOURCE` stays unconditionally. `symbolicateFrame` was extracted into `js/scripts/symbolicate-core.ts` (the CLI is a thin printer over it; old `<null>` stacks now print `[no mapping]` instead of crashing the run), including a one-column call-site fallback the e2e gate itself caught: the engine reports the call opcode one column before esbuild's named identifier segment, so a nameless exact hit retries one column right, only when the neighbour is named. |
| quickjs-ng bump bot | P2 → **shipped** (2026-08-21) | M | `.github/workflows/vendor-quickjs.yml` — daily, proposes the newest release that has soaked ≥7 days. Policy is `js/scripts/pick-quickjs-release.ts` with tests: soak window, hotfix warning (a candidate is still proposed while something newer soaks, but the PR opens with a `[!WARNING]` block naming it — the day-seven vendor of a release upstream already replaced is the exact mistake), downgrade guard, draft/prerelease filter, skip-list. It re-vendors with the same `tools/vendor-quickjs/run.sh` a human uses, fails loudly if upstream's `qjs_sources` set stopped matching our four `.c` files, measures embed-smoke before/after, and CALLS `ci.yml` + `build.yml` as reusable workflows so the gates run in its own run — necessary because a PR opened with `GITHUB_TOKEN` raises no `pull_request` event. M9 is preserved by NOT letting the bot attest: `engine-attest.yml` fails any PR touching `js/swift/Sources/CQuickJS` until a human adds `engine-digest-attested`. **Owner action: mark `engine attest / attested` a required check in branch protection**, otherwise the label is advisory. |
| Symbol store keyed by `releaseId` + a `symbolicateFrame` helper | **shipped 2026-08-21** | S | `buildBundles({symbols})` (opt-in; absent = byte-identical build) writes `<dir>/<releaseId>/<target>/{bundle,map,metadata.json}`, CLI `--symbols`; `symbolicate` gained `--symbols/--release/--target` and a `--diagnostics` mode that reads the inspector-snapshot ring shape and resolves each record against ITS OWN releaseId. No second identity: the id is `manifest.mts`'s own contentHash (measured 55 ms on the 628 KB bundle — cheap enough to not cache). One real edge found and pinned: two targets built from one entry produce identical bytes and therefore ONE releaseId with two target subdirs. |
| Bundle composition report from the esbuild metafile | **measured & all three levers shipped 2026-08-21** | M | The 2026-08-21 metafile pass found react-reconciler+scheduler+react at 83.8% of the WIDGET bundle, pulled in so a one-shot static render could mount a fiber tree and throw it away — plus two smaller leaks. All three shipped the same day. **(1) Reconciler-free widget render:** `js/src/staticRender.ts` walks the element tree straight into the shape `serialize.ts` already consumes (serialization reused verbatim — post-order ids and `<Text>` folding mirrored because they are literally on the wire), with a minimal hook dispatcher (react-shallow-renderer technique, cited) so React-Compiler-compiled consumer components still work; `useState` returns the initial value and throws if set during render; Suspense/lazy/portals throw with the type named. Widget **153,362 → 27,870 B** from this alone; the app deliberately gains the shared walker (+3.6 KB) rather than risking two implementations disagreeing about the same payload (the app publishes, the extension re-renders — ARCH-06). Guards: 20 golden cases rendered through BOTH paths with deep-equal output, a metafile test asserting reconciler/scheduler/renderer contribute ZERO bytes to the widget bundle (tree-shaking is silent when it breaks), widget size budget tightened 1000→100 KB so a returning reconciler is loud, and the ARCH-11 fixtures regenerated byte-identical. Purity rule documented in ui-guide.md. **(2) fetch shim** now derived from the target's `requiredFeatures` (widget −3,798 B; a second injected module was tried and rejected — it cost +262 B per bundle in wrapper overhead, so the gate is a define esbuild folds). **(3) inspector** compiles out of shipping bundles via a `REACT_WATCH_DEV` define (`NODE_ENV` could not carry it: the preset pins it to "production" even in dev, deliberately) — app −1,357 B, dev loop keeps it. Combined with everything above: **app 197 KB, widget 23 KB**, bytecode boot 8.1 → 4.9 ms. |
| ES target sweep (ES2020 → 2021/22/23) | **measured & closed 2026-08-21** | S | **Answered: keep ES2020.** Both bundles built at es2020/21/22/23/24/esnext through the real preset (React Compiler on); every variant compiled to `.qbc` AND run through the full qjs-smoke path in the vendored engine. Raising the target saves **393 B on the app (0.20%), 344 B on the widget (0.22%), 110 B of bytecode (0.05%)** — and es2021 saves *exactly zero*; everything from es2022 up is byte-identical. The entire delta is esbuild's class-field lowering helper (17 call sites). No target produces syntax the engine rejects, not even `esnext`. So NF-24's direction is confirmed and its magnitude refuted: down-levelling costs 0.2% against budgets of 2000/1000 KB. ES2020 stays because it is a **consumer-facing floor the published docs promise**, not an engine limit; preset.mts's stale "both Bellard quickjs and quickjs-ng cover it" justification is replaced with that reasoning plus these numbers, so the next reader who notices the engine is ES2023-capable finds the answer instead of re-opening the question. |
| Terser as a final pass after esbuild | **measured & declined 2026-08-21** | M | **The win is real, small, and on the wrong axis.** Terser 5.50.0 (conservative config, no `mangle.properties`, no unsafe) after esbuild, full behavioural proof in the vendored engine (the qjs-smoke assertions re-run verbatim on every variant, plus `.qbc` boot through embed-host): app JS 199,674 → 192,778 B (**−3.45%**), widget −1.50% — but on the artifact that SHIPS, the `.qbc`, the saving is **7,844 B total (−2.24%)** against budgets the bundles use 10% of, heap is bit-identical and boot is inside noise, i.e. nothing on the two axes where the minification flip actually paid. `passes=2` adds 480 B; **`passes=3` adds 16 B for +514 ms**. Cost: Terser is ~23× slower than esbuild's whole minify pass (+1.83 s on a 3.7 s build, +49%), needs `sourceMap.content` chaining with its named fidelity risk, and flattens 84 lines → 68, coarsening the `.qbc` line number. For the record, Terser ALONE beats esbuild alone by 2.6% — so the honest phrasing is "esbuild+Terser beats esbuild by 3.45%, and 3.45% does not clear the bar." Terser output is byte-deterministic (same SHA-256 across runs). Revisit only if flash pressure becomes real. |
| JS obfuscation | **measured & rejected 2026-08-21, permanently** | S | **Worse than a no-op on every axis it claims to serve.** javascript-obfuscator 5.5.0 with every risky transform off (no property renaming, no control-flow flattening, no dead code, no self-defending), on the esbuild-minified app bundle, full behavioural pass in the vendored engine: **+59,855 B JS (+30.0%), +38,119 B of `.qbc` (+18.6%), +0.3 MB QuickJS heap on the bytecode path (0.8 → 1.1 MB), boot 7.5 → 13.0 ms (+72%)** — the string-array indirection runs at startup and lands on the widget's 16 MB heap too. With `stringArray:false` the runtime cost mostly recovers and it STILL ships +22.7% JS / +7.7% bytecode for nothing. And the promised IP friction does not exist: every string is plaintext in the output (`'hydration.glasses'`, `'publishWidgets'` read straight out of the array), the shipped source map goes inert, and identifiers were already mangled by esbuild. It does run — the answer is not "it breaks", it is "it costs 38 KB of flash, 0.3 MB of heap and 5.5 ms of boot to hide nothing". `.qbc` with `STRIP_SOURCE` already removes readable text; obfuscation is never a security boundary. |
| JavaScriptCore on watchOS | **declined 2026-08-21**, with a trigger | XL | Investigated via LingXia-Dev/Rong's `javascriptcore/sys` (which states plainly: *"Other Apple targets such as tvOS/watchOS have no system JSC here, so they use the source backend too"*). That means building WebKit/JSCOnly from source for watchOS: no system framework, no JIT (watchOS forbids it, so JSC runs its CLoop interpreter and loses the advantage that justifies its size), a static library measured in MB against quickjs-ng's ~1 MB of objects, plus ICU and unofficial watchOS triples we would patch on every upstream bump. The one genuine prize is JSC's Web Inspector protocol — real breakpoints, which QuickJS lacks. **Cheaper path to that same prize:** a DEBUG-only DAP adapter on the Swift side driving quickjs-ng's interrupt/debug hooks over a socket Swift owns (prior art: `koush/quickjs-debugger`, `vscode-quickjs-debug`); the "QuickJS has no WebSocket" objection does not apply when the native half owns the transport. Revisit JSC only if Apple ships a public watchOS JSC. |
| **Engine alternatives behind a swappable adapter** (PrimJS, JSCOnly-jitless) | P3, experiment — **both measured & dropped 2026-08-21**; branches kept, never merged | L | Maintainer request 2026-08-21: try engines as REPLACEABLE alternatives, not replacements — quickjs-ng stays the default and nothing is deleted; the experiment lives on its own branch and merges only if the numbers win. The seam mostly exists already (`JSRuntime` is the only thing that touches the C API; every caller goes through it), so "adapter" means: keep the engine behind that boundary and make the target swappable at build time. **(1) PrimJS — measured 2026-08-21 and DROPPED** (branch `experiment/primjs-engine`, commit 45fc478; full report in its `tools/primjs-smoke/README.md`). It DOES run the real production bundle (tree commits, counter round-trips) — while computing `null ?? x` WRONG: PrimJS 4.0.0 compiles `??` to `OP_is_undefined` (`quickjs.cc:22356`) and has no `OP_is_undefined_or_null` opcode at all, so nullish coalescing falls through on `undefined` but not `null` — silently, and our bundle has 47 live `??` sites including inside React's reconciler; the smoke passed only because the demo path happens to hit `undefined`. Beyond the disqualifier: not faster here (its template interpreter + tracing GC are arm64+LP64-assembly-only — the exact features that cannot run on watchOS), and **arm64_32 is unsupported by construction** (value representation keyed on `__aarch64__` while the watch is `__aarch64__` with 4-byte pointers; the 376 KB hand-encoded interpreter assembly is LP64 with no generator upstream). Adopting it would also trade away the heap gate (`JS_ComputeMemoryUsage` writes nothing), correct stack columns (frames point after the call returns — `qbc-symbolication` would fail), STRIP flags (2× blob), `JS_UpdateStackTop` (ARCH-08), and the promise-rejection push API. Dropped, not parked — and the 2026-08-21 upstream/platform follow-up (branch commit 82b5375) made the revisit trigger PRECISE instead of vibes. The lineage hypothesis was refuted: the fork base is 2020-era and INHERITED working `??` — PrimJS removed `OP_is_undefined_or_null` from the opcode table and rewrote the codegen with the null half missing, while `optional_chain_test()` three screens away does the correct two-test dance for the same missing opcode (so the fix is ~6 lines upstream). It is KNOWN upstream: lynx-family/primjs#44, open since 2025-04-29 with zero response — shippable for 16 months only because Lynx's rspeedy pins the main thread to es2019 and transpiles `??` away before PrimJS ever sees it. Lowering OUR target would fix only 3 of the 12 gaps (esbuild lowers syntax, never injects polyfills — `Array.at`/`Object.hasOwn`/`replaceAll`/`Error cause` stay broken, and `/d` regexp literals actually DEGRADE into runtime throws). The arm64_32 objection now has an expiry date instead of being permanent: Series 9+/Ultra 2 run arm64 apps from watchOS 26, and the watchOS 27 device set (SE 3, S9+) is EXACTLY the arm64 set — but this package floors at watchOS 10 where arm64_32 is mandatory, and Apple has required an arm64 slice on every submission since April 2026 anyway (fat binary era). **Reopen only when BOTH hold: (1) a tagged PrimJS release where `js_parse_cond_expr` tests `OP_is_null` and `nullish-probe.js` prints 8 green rows, and (2) this package's floor reaches watchOS 27.0** (sane ~2027-28, not before). Both checkable in minutes. The compat census (`compat/quickjs.h`, ~90 lines mapping `LEPUS_*`, including the header that `#define`s `printf` away) stays on the branch as the template for trying any future engine. **(2) JSCOnly jitless, self-built — measured 2026-08-21 and DROPPED** (branch `experiment/jsconly-engine`, commit 8f651e7; report in its `tools/jsconly-smoke/README.md`, seam/ICU/licensing analysis in `ADAPTER.md`). webkitgtk 2.52.6 at `-DPORT=JSCOnly -DENABLE_C_LOOP=ON -DENABLE_JIT=OFF` (plus WebAssembly and the sampling profiler explicitly OFF — WebKit models them as hard `FATAL_ERROR` conflicts with C_LOOP and they default on): 23 min on 4 cores, ~9 of them the single-threaded `LowLevelInterpreter.cpp` every other JSC unit queues behind. It DOES run the real 201,829 B production bundle byte-identically to quickjs-ng — `??` correct on all 9 probe rows (the exact PrimJS disqualifier) and 28/30 on the ES census, the one gain being `Intl`, inseparable from mandatory ICU (no `ENABLE_INTL` switch exists). Three findings close the row: **empty-context RSS is 16.1 MB vs 3.0 MB — the widget's entire 16 MB heap cap is gone before a line of JS runs**; the linked stripped host is **14.3 MB vs 1.09 MB (13.1× with `--gc-sections`), before the 36 MB of ICU shared libraries**; and the C API exposes **no bytecode serialization at all**, so the `.qbc` path that actually ships (5.3 ms boot) becomes 32.1 ms of source parse (~6×) and `tools/qjs-compile` loses its subject. The real-but-unbuying column: a faster parser, free microtask draining, and stacks that DO carry line:column (frame 2 even recovers a better name than quickjs-ng) — but spelled `f@file:1:2`, which the shipped `STACK_FRAME_RE` does not match, and the throw frame's name misses at JSC's chosen column, so `qbc-symbolication` fails anyway. Both platform questions settled with sources: `JavaScriptCore.framework` is genuinely absent from the watchOS SDK (Apple's docs JSON lists six platforms for `JSContext`/`JSValue`/`JSVirtualMachine`, watchOS never among them — the row above's premise holds), while **arm64_32 is NOT a blocker, the exact opposite of PrimJS**: WebKit keys its value model on `__SIZEOF_POINTER__`, knows `OS(WATCHOS)` by name and carries an ARM64_32 offlineasm backend. Also recorded: 185/3,223 JSC + 91/952 WTF files are LGPL-2.1+ (`Parser.cpp` and `Lexer.cpp` included) — a static-link obligation this MIT-licensed package does not carry today. **Dropped, not parked**, with a single reopen trigger: Apple shipping a public watchOS JavaScriptCore, which deletes the size, RSS-floor and framework findings in one move — the same trigger the row above already names. |
| Source-map `sourcesContent` policy | **decided 2026-08-21** | S | We DO emit it (48 entries, ~1.08 MB of the app map) and it stays: without it a stack from three months ago needs the matching checkout to be readable, which is the difference between symbolicating and not. Paths are already relative (`../src/fetch.ts`) with no absolute/machine leakage. The rule that makes it safe is distribution, not content: the map is never referenced from the bundle (`sourcemap: "external"`, no `sourceMappingURL`), never copied into `app/targets/*/assets`, and never published. **Checked 2026-08-21 — clean, and structurally so:** `npm pack` gives 245 files / 1.1 MB with **zero** `.map` entries. Three independent reasons, not luck: `files` is an allowlist with no `dist` entry (so `js/dist/*.map` is unreachable whatever .gitignore says), `scripts/build-node.ts` passes no `sourcemap` option so `dist-node/` emits none, and no shipped file carries a dangling `sourceMappingURL`. LICENSE, NOTICE and the vendored `CQuickJS/LICENSE` all ship, so the attribution chain is complete. (Noted, not a defect: `swift/Tests` ships too — 85 files, 421 KB, ~9% of the tarball — deliberately, so `pnpm test:swift` works from an install.) |
| **DAP debugger (DEBUG-only) — spike shipped 2026-08-21** | P2 → prototype landed | L | `docs/design-dap-debugger.md` + a working prototype: statement-level probes injected by `esbuild/debug-probe.mts` (dev/debug builds only; a test pins that production output carries no probes and the React Compiler stays active — the two transforms may not share the `.tsx` onLoad, stated in preset.mts), runtime halves `src/debugProbe.ts`/`debugWire.ts`, `bin/dap-session.mts` + `debug-server.mts` speaking real DAP, and `DebugPollTransport.swift`. Two findings that reshaped it: quickjs-ng has NO debugger hooks upstream (ng#757 — `JS_SetInterruptHandler` has no frame, no position; koush's debugger is an engine fork we refuse), and the recommended fetch-based pause loop would DEADLOCK (fetch settles by hopping onto the very main queue the paused loop occupies) — the transport is a dedicated poll instead. Reached pause/continue/next/stepIn/stepOut/evaluate + stackTrace, gated end-to-end in the vendored engine. Honest boundary: the twelve `#if os(watchOS)` wiring lines compile only under xcodebuild — Mac verification owed. |
| Publish job engine gate | **shipped 2026-08-21** | S | release.yml's vitest now runs `REQUIRE_QJS=1` against the vendored engine, built COLD in the job (25 s measured) — a publish job caches nothing, deliberately: restoring a cache another workflow could poison inside the OIDC-privileged job is the classic supply-chain hole. The old "no qjs here" comment's apt-era reasoning is recorded as dead in the new comment. |
| Real-bundle boot on the simulator | **shipped 2026-08-21** | S | `BundleSmokeTests.swift`: the actual `dist/bundle.js` AND `dist/bundle.qbc` evaluated through `JSRuntime`, asserting the C harness's full contract (wire version, NavigationStack root with real children, ARCH-09 lazy launch, accepted pathChange, press advances count by one, widget published, onError empty) — on Linux `swift test` and, via build.yml now building the bundle+bytecode first, on the watch simulator. Ordering trap found and documented: a JS-only `pnpm build` deletes the stale `.qbc`, so build → build:bytecode order matters (CONTRIBUTING + test-watch.sh updated). |
| OTA on-device bytecode cache carries source text | **fixed 2026-08-21** | S | `compileToBytecode` wrote `BYTECODE` alone; now `BYTECODE\|STRIP_SOURCE` via the renamed shim accessor (`qjs_write_obj_bytecode_strip_source` — renamed precisely so a policy-free accessor cannot let the two compile sites diverge again; qjs-compile.c carries the back-pointer). Measured on device-shaped input: blob 908,332 → 252,952 B (3.6×), heap after `JS_ReadObject` −51%, read −0.32 ms. Test pins all three edges: no source bytes, still evaluates, stack still carries line:column (verified red in BOTH wrong directions before landing). Known local gotcha recorded: SwiftPM does not rebuild on a C-header-only change — touch a Swift file or you measure the old policy. |
| react-compiler.test flake under full parallel load | **closed 2026-08-22** | S | Recurred twice more as the suite grew 793 → 822, always a 5 s TIMEOUT under full parallel load and always green isolated — so the recorded suspects (memory pressure, babel cache) were wrong and the cause was simpler: this test compiles the full production bundle through Babel + the React Compiler exactly like build-preset's tests, and every one of those carries an explicit 60 s timeout while this one sat on vitest's 5 s default. Brought to the family convention (`60_000`), assertion untouched. |
| Code-quality battery (free, no accounts) | **adopted 2026-08-21** | M | Maintainer ask: best-in-class quality gates, free, nothing account-gated. Adopted after an audition on this tree rather than by reputation: publint 0.3.23, attw 0.18.5 (`--profile esm-only`; `internal-resolution-error` ignored with the reason written down — inherent to shipping TS source as the types), knip 6.32.2 (entry-point design: the exports map, `bin`, `sideEffects` and the build/test doorways ARE the public surface, so what it reports is genuinely unreachable), dependency-cruiser 18.2.0 (module-boundary rules, type-only cycles exempted), shellcheck, typos, lychee offline, cppcheck weekly over the vendored C, CodeQL (js-ts + actions, default queries, SHA-pinned), coverage report-only at 94.07% lines (thresholds refused on purpose — a number to watch, not a gate to game). One command serves CI and local alike: `pnpm --filter react-watchos quality` → `js/scripts/quality.sh` — CI sets `REQUIRE_ALL_TOOLS=1`, a laptop without a tool skips it loudly. The audition found three real defects, headlined by **Biome silently linting NOTHING under bin/, esbuild/, plugin/ and scripts/ for months** (31 files outside the `includes` globs; 173 files checked now), plus a dead `#anchor` lychee caught and an SC2012 unmatched-glob bug in `run-watch-sim.sh`; knip retired 13 dead exports. eslint-plugin-sonarjs auditioned and DROPPED on numbers, not taste: 85 files, 34 findings, zero real bugs, the largest class a rule that contradicts this repo's `exactOptionalPropertyTypes` (per-rule table in [quality-gates.md](./quality-gates.md); the 2026-07 decision-log guess superseded in place with the measurement). The gate earned its keep the same day it merged: knip flagged the DAP wave, which surfaced `debug-server.mts` stamping its dbg.json fallback with the WIRE version constant instead of the MANIFEST one — two versioned surfaces equal only by coincidence. The battery's first cross-tool conflict arrived within the hour of merging: trufflehog's Github detector read codeql.yml's SHA-pinned `github/codeql-action@<40-hex>` — the pin zizmor requires — as a classic token and failed main on an unverified commit hash; the scan is now scoped `--results=verified,unknown` (fail on live or indeterminate credentials, not on candidates the service rejected), which is structural where allowlisting the SHA would re-break on every codeql-action bump — pattern-without-liveness stays gitleaks' axis, reproduced red/green with the real CLI before pushing. |
