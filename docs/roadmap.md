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

## DX follow-ups from the first real consumer migration (2026-08-06)

Migrating ctrl-a-remote onto the published package surfaced three concrete
testing-DX gaps — each one forced the consumer to hand-roll internals:

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

Also owed from the same pass: a MIGRATIONS.md (pre-1.0 breaking changes ship
as minors; the changelog says WHAT changed, a migration note should say what
consumers DO — the ctrl-a-remote commit 63e331e3 in the old monorepo is the
worked example for 0.1.0-era code).

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
| Focus management | P2 | M | Only one Crown-focusable element at a time on watchOS; needs an addressable focus model. Gates multi-Crown screens. |

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

## Open follow-ups (recorded 2026-08-12, after the defect backlog emptied)

Nothing here is broken today; each is a gap we named while doing something
else and chose not to chase in the same pass. Roughly in the order they
earn their keep.

- **IPv6 loopback is not a usable OTA dev host, and never was.** `http://[::1]:8080`
  is refused: `updateURLViolation`'s host regex is `[^/:?#]*`, which stops at
  the first colon, so the host it hands `isPrivateHost` is the bare string
  `"["`. (The old `host === "[::1]"` branch could therefore never fire —
  removing it in the dotted-quad fix changed no behavior. Verified by running
  the regex against `http://[::1]:8080/m.json`.) Adding real support means:
  parse a bracketed host in the URL regex, accept `::1` (and only loopback —
  ULA `fc00::/7` and link-local `fe80::/10` are a separate decision), mirror
  it in Swift's `UpdateURLPolicy`, and pin both sides, since the two
  implementations are contract-paired.
- **`pendingRejections` keys on a raw `JSValue` pointer with no owning
  reference** (from the unhandled-rejection defer fix). If a promise with no
  live references is freed, quickjs-ng can hand the same address to a new
  promise, and a deferred report would attach to the wrong one. Fix: retain
  the promise for as long as it sits in the map, or key on a value the engine
  guarantees unique for the lifetime of the entry.
- **The `watchConnectivity.file` park/replay path has no test.** `isReady`
  tracking `jsReady`, `deliver`'s park branch, `replayParkedFileEvents()`
  running before other boot listeners, and the widened `transferLock` are all
  reasoned-through but unpinned — they need a fake WCSession seam (the real
  one cannot be driven in a test).
- **The `.qbc` content hash has no three-way parity test.** The C tool, the
  Swift verifier and the Node builder each implement FNV-1a; only the Swift
  side is unit-tested. A single shared vector file asserted from all three
  would stop a silent drift that presents as "every boot falls back to
  parsing the source".
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
- **Two upstream bugs are carried as local patches, with no issue filed.**
  `react-native-worklets`' babel plugin calls `numericLiteral(-27)`, which
  `@babel/types` >= 7.28 rejects (present in every release through the latest
  nightly; a FlareLog-side pnpm patch works around it). `@bacons/apple-targets`
  supports one target per product type — its lookup falls back to the first
  same-type target and corrupts it (`with-xcode-changes.js`, unchanged through
  5.0.0). Both deserve upstream issues with the repro we already have.
- **Cooldown-held bumps to revisit.** `expo` 57.0.11 (clears 2026-08-13) and
  57.0.12 (2026-08-17); FlareLog's `expo-*` family clears 2026-08-18. Nothing
  to do but re-run the wave after those dates.
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

## Build pipeline & engine currency (recorded 2026-08-21)

Context: 2026-08-20/21 shipped minification-by-default, external source maps on
by default, and the vendored-engine gate. A review pass over that work (a
14-phase plan a consumer generated with ChatGPT, reconciled against the actual
tree) surfaced one real defect and a queue of measurable questions. Recorded
here so the queue survives the session that found it.

| Item | Priority | Size | Notes |
|---|---|---|---|
| **Production `.qbc` carries no stack positions** | **P1 — measured 2026-08-21, fix pending a size call** | S | **Confirmed, quantified, and the fix is one flag.** Measured on the vendored quickjs-ng 0.16.1 with three writer variants, real app bundle: **A (today, `STRIP_SOURCE\|STRIP_DEBUG`)** → every frame is `at d0 (<null>:0:1)`; no filename, no line, no column, so the source map shipped on 2026-08-21 is **inert on the path the watch actually runs**. **B (`STRIP_SOURCE` only)** → `at d0 (bundle.min.js:16:25030)`, byte-identical to the source-parsed baseline, and the column was verified to land on the real throw site. **C (nothing stripped)** → identical stacks to B for +702 KB, so `STRIP_SOURCE` stays on unconditionally and C is dead. Cost of B over A: **+45.4 KB `.qbc` (206 KB → 251 KB, +22%)**, +0.03 MB QuickJS heap, +0.14 ms `JS_ReadObject`, eval time unchanged — and the debug tables scale with opcode count, not source size (the same ~45.4 KB on the unminified bundle). The `lineLimit` contingency is NOT needed: esbuild already emits ~84 lines, so line is coarsely useful and the column is exact. Remaining question is purely budget — 45 KB of watch flash for readable production stacks — plus whether to ship debug-info `.qbc` always or only on a diagnostics flavour. Then the end-to-end fixture (throw in a known `.tsx` → real `.qbc` → map → original position) can finally be written. |
| quickjs-ng bump bot | P2 → **shipped** (2026-08-21) | M | `.github/workflows/vendor-quickjs.yml` — daily, proposes the newest release that has soaked ≥7 days. Policy is `js/scripts/pick-quickjs-release.ts` with tests: soak window, hotfix warning (a candidate is still proposed while something newer soaks, but the PR opens with a `[!WARNING]` block naming it — the day-seven vendor of a release upstream already replaced is the exact mistake), downgrade guard, draft/prerelease filter, skip-list. It re-vendors with the same `tools/vendor-quickjs/run.sh` a human uses, fails loudly if upstream's `qjs_sources` set stopped matching our four `.c` files, measures embed-smoke before/after, and CALLS `ci.yml` + `build.yml` as reusable workflows so the gates run in its own run — necessary because a PR opened with `GITHUB_TOKEN` raises no `pull_request` event. M9 is preserved by NOT letting the bot attest: `engine-attest.yml` fails any PR touching `js/swift/Sources/CQuickJS` until a human adds `engine-digest-attested`. **Owner action: mark `engine attest / attested` a required check in branch protection**, otherwise the label is advisory. |
| Symbol store keyed by `releaseId` + a `symbolicateFrame` helper | P2 | S | `js/scripts/symbolicate.ts` is a CLI over `@jridgewell/trace-mapping`; the reusable shape is `symbolicateFrame({map, line, column}) -> {source, line, column, name, sourceContent}` plus a `symbols/<releaseId>/{bundle.js,bundle.js.map,metadata.json}` layout so a stack from the field finds its map. **Reuse `releaseId`** (already an FNV-1a over the exact shipped bytes, already in diagnostics) — do NOT add a third identity next to "OTA compatibility version" and "OTA freshness". Widget artifacts need the same treatment with the target in the path, so an app map can never be applied to a widget stack. |
| Bundle composition report from the esbuild metafile | **measured 2026-08-21; one large lever found** | S→M | Built both real targets with `metafile` + `analyzeMetafile` (app 199,674 B / 48 inputs, widget 153,362 B / 33 inputs, reproducing the documented sizes exactly). **The finding: `react-reconciler` + `scheduler` + `react` are 128,478 B — 83.8% of the WIDGET bundle — pulled in for one call.** `src/widgets.ts` `renderToTree()` mounts a fiber tree, runs a scheduler and a full commit phase to produce a single static `SerializedNode` that is JSON-stringified and thrown away. ARCH-03 split the bundles at the app-UI level (`demo/App.tsx`, `update.ts`, `workoutPlans.ts`, `bluetooth.ts` are all correctly absent, and `navigation.tsx` shakes 19,203 → 276 B) but left the whole React runtime in the widget. A reconciler-free static walker over the existing `src/serialize.ts` would take the widget **153 KB → ~33 KB (−79%)** — RISKY, because it produces the wire payload the widget extension decodes, so it must emit a byte-identical `SerializedNode` and be driven by the same golden fixture, and it makes "widget components are pure" an explicit rule (no hooks/state). Two cheaper, safer ones alongside it: `installFetch` is forced into every bundle by the injected `install-shims.ts` even though the widget's declared contract is `["storage","widgets"]` — gating it measured **−3,711 B** on the widget; and `src/inspector.ts` (1,307 B) survives in the SHIPPING app bundle because `demo/app.entry.tsx` imports `startInspector` at module scope and only gates it at runtime. Also recorded: the reconciler is CJS so **zero** tree-shaking happens (407,775 → 116,982 B is pure minification), and the widget carries 44 `hydrat*`, 17 `Suspense`, 10 `ViewTransition`, the DevTools injection path and the form-action queue — none reachable from a serialized wire host. No module is duplicated *within* a bundle (`singleCopyPlugin` holds), but the same 117 KB reconciler is copied into both target assets, ~234 KB of app flash. |
| ES target sweep (ES2020 → 2021/22/23) | **measured & closed 2026-08-21** | S | **Answered: keep ES2020.** Both bundles built at es2020/21/22/23/24/esnext through the real preset (React Compiler on); every variant compiled to `.qbc` AND run through the full qjs-smoke path in the vendored engine. Raising the target saves **393 B on the app (0.20%), 344 B on the widget (0.22%), 110 B of bytecode (0.05%)** — and es2021 saves *exactly zero*; everything from es2022 up is byte-identical. The entire delta is esbuild's class-field lowering helper (17 call sites). No target produces syntax the engine rejects, not even `esnext`. So NF-24's direction is confirmed and its magnitude refuted: down-levelling costs 0.2% against budgets of 2000/1000 KB. ES2020 stays because it is a **consumer-facing floor the published docs promise**, not an engine limit; preset.mts's stale "both Bellard quickjs and quickjs-ng cover it" justification is replaced with that reasoning plus these numbers, so the next reader who notices the engine is ES2023-capable finds the answer instead of re-opening the question. |
| Terser as a final pass after esbuild | **measured & declined 2026-08-21** | M | **The win is real, small, and on the wrong axis.** Terser 5.50.0 (conservative config, no `mangle.properties`, no unsafe) after esbuild, full behavioural proof in the vendored engine (the qjs-smoke assertions re-run verbatim on every variant, plus `.qbc` boot through embed-host): app JS 199,674 → 192,778 B (**−3.45%**), widget −1.50% — but on the artifact that SHIPS, the `.qbc`, the saving is **7,844 B total (−2.24%)** against budgets the bundles use 10% of, heap is bit-identical and boot is inside noise, i.e. nothing on the two axes where the minification flip actually paid. `passes=2` adds 480 B; **`passes=3` adds 16 B for +514 ms**. Cost: Terser is ~23× slower than esbuild's whole minify pass (+1.83 s on a 3.7 s build, +49%), needs `sourceMap.content` chaining with its named fidelity risk, and flattens 84 lines → 68, coarsening the `.qbc` line number. For the record, Terser ALONE beats esbuild alone by 2.6% — so the honest phrasing is "esbuild+Terser beats esbuild by 3.45%, and 3.45% does not clear the bar." Terser output is byte-deterministic (same SHA-256 across runs). Revisit only if flash pressure becomes real. |
| JS obfuscation | **measured & rejected 2026-08-21, permanently** | S | **Worse than a no-op on every axis it claims to serve.** javascript-obfuscator 5.5.0 with every risky transform off (no property renaming, no control-flow flattening, no dead code, no self-defending), on the esbuild-minified app bundle, full behavioural pass in the vendored engine: **+59,855 B JS (+30.0%), +38,119 B of `.qbc` (+18.6%), +0.3 MB QuickJS heap on the bytecode path (0.8 → 1.1 MB), boot 7.5 → 13.0 ms (+72%)** — the string-array indirection runs at startup and lands on the widget's 16 MB heap too. With `stringArray:false` the runtime cost mostly recovers and it STILL ships +22.7% JS / +7.7% bytecode for nothing. And the promised IP friction does not exist: every string is plaintext in the output (`'hydration.glasses'`, `'publishWidgets'` read straight out of the array), the shipped source map goes inert, and identifiers were already mangled by esbuild. It does run — the answer is not "it breaks", it is "it costs 38 KB of flash, 0.3 MB of heap and 5.5 ms of boot to hide nothing". `.qbc` with `STRIP_SOURCE` already removes readable text; obfuscation is never a security boundary. |
| JavaScriptCore on watchOS | **declined 2026-08-21**, with a trigger | XL | Investigated via LingXia-Dev/Rong's `javascriptcore/sys` (which states plainly: *"Other Apple targets such as tvOS/watchOS have no system JSC here, so they use the source backend too"*). That means building WebKit/JSCOnly from source for watchOS: no system framework, no JIT (watchOS forbids it, so JSC runs its CLoop interpreter and loses the advantage that justifies its size), a static library measured in MB against quickjs-ng's ~1 MB of objects, plus ICU and unofficial watchOS triples we would patch on every upstream bump. The one genuine prize is JSC's Web Inspector protocol — real breakpoints, which QuickJS lacks. **Cheaper path to that same prize:** a DEBUG-only DAP adapter on the Swift side driving quickjs-ng's interrupt/debug hooks over a socket Swift owns (prior art: `koush/quickjs-debugger`, `vscode-quickjs-debug`); the "QuickJS has no WebSocket" objection does not apply when the native half owns the transport. Revisit JSC only if Apple ships a public watchOS JSC. |
| Source-map `sourcesContent` policy | **decided 2026-08-21** | S | We DO emit it (48 entries, ~1.08 MB of the app map) and it stays: without it a stack from three months ago needs the matching checkout to be readable, which is the difference between symbolicating and not. Paths are already relative (`../src/fetch.ts`) with no absolute/machine leakage. The rule that makes it safe is distribution, not content: the map is never referenced from the bundle (`sourcemap: "external"`, no `sourceMappingURL`), never copied into `app/targets/*/assets`, and never published. **Checked 2026-08-21 — clean, and structurally so:** `npm pack` gives 245 files / 1.1 MB with **zero** `.map` entries. Three independent reasons, not luck: `files` is an allowlist with no `dist` entry (so `js/dist/*.map` is unreachable whatever .gitignore says), `scripts/build-node.ts` passes no `sourcemap` option so `dist-node/` emits none, and no shipped file carries a dangling `sourceMappingURL`. LICENSE, NOTICE and the vendored `CQuickJS/LICENSE` all ship, so the attribution chain is complete. (Noted, not a defect: `swift/Tests` ships too — 85 files, 421 KB, ~9% of the tarball — deliberately, so `pnpm test:swift` works from an install.) |
