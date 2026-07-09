# Performance & Battery Audit — 2026-07-08

Full-codebase battery/perf review of the app runtime **and** the widget
extension, prompted by a field report (~10% drain in 3h indoors after installing
the app + a widget). Method: the whole `js/swift` Swift surface and the entire
`js/src` + `examples/` JS surface were read subsystem-by-subsystem against a
watch energy rubric (repeating work, hot radios, wakeups, re-render cost,
resource lifecycle, QJS engine cost). Findings below are verified against the
cited lines.

This supersedes nothing in `docs/performance-measurement.md` — that doc is *how
to measure*; this doc is *what we found by reading*. On-watch numbers are still
unmeasured (see that doc §7); everything here is a static-analysis finding, not
a device measurement.

Severity key:
- **P0** — unbounded or background drain: a radio/session that can stay hot with
  no user-visible cause until app kill.
- **P1** — ongoing waste under normal use: real energy cost on a common path,
  but bounded by the OS or by the interaction.
- **P2** — minor / conditional / cleanup.

---

## P0 — unbounded drain

### P0-1 · BLE auto-reconnect scans forever (no timeout, no backoff)
`BluetoothBridge.swift:358` (`didDisconnectPeripheral` → `if session.shouldAutoReconnect { startScan() }`), also `:173`; scan at `:236-241`.

On any unexpected drop, the central re-enters `scanForPeripherals` and there is
**no attempt cap, no backoff, no deadline** — `shouldAutoReconnect` is just
`!userInitiatedDisconnect`. The 15s `connectTimeout` is armed only for the
initial `bleConnect`, never for reconnect. If the peripheral never re-advertises
(out of range, powered off, taken off the wrist), the BLE radio **active-scans
indefinitely**. Continuous BLE scanning is a top-tier watch drain.

**Fix:** bounded reconnect — exponential backoff with a ceiling and a total
deadline; on exhaustion `stopScan()` and emit a terminal `unavailable` state.
Reuse the existing `armConnectTimeout`/epoch machinery.

### P0-2 · `disconnect()` never stops an in-flight scan → radio stays hot and can silently reconnect
`BluetoothBridge.swift:243-258` (no `stopScan()`); `didDiscover` at `:331-334`.

During an auto-reconnect scan `peripheral == nil`, so a JS `bleDisconnect` →
`disconnect()` sets the user-initiated latch but takes the `else` branch and
**never stops the scan**. Worse, `didDiscover` (`:334`) calls `central.connect`
**unconditionally** — no `shouldAutoReconnect`/`userInitiatedDisconnect` guard —
so the lingering scan can rediscover and **reconnect a peripheral the user
explicitly disconnected**. This is a correctness bug on top of the drain.
(Verified: `disconnect()` at 243-258 has no `stopScan`; `didDiscover` at 331-334
connects with no guard.)

**Fix:** `central?.stopScan()` at the top of `disconnect()` (unconditionally,
before the `peripheral` check); guard `didDiscover` with
`!session.userInitiatedDisconnect`.

### P0-3 · HKWorkoutSession (heart rate) has no native backstop on background/blur/teardown
Start `SensorBridge.swift:99-139`; stop only via explicit JS `("stop","heartRate")` (`:141`) or reload `stopAll()` (`:60`, from `boot()`); no `deinit` in `SensorBridge`.

`beginWorkout()` starts an `HKWorkoutSession` + `HKLiveWorkoutBuilder`, which by
design **keeps the app alive in the background and the HR sensor sampling**. It
ends only on an explicit JS stop or a runtime reload. If the screen blurs / the
app backgrounds and JS never calls stop, the session persists and the sensor
stays hot until the next reload or app kill. Because there is no `deinit`, a
deallocated bridge leaks the daemon-owned session at the system level.

This is the most likely single cause of a "watch got hot / drained fast" report
whenever an app uses heart rate. The `scenePhase` handler
(`ReactWatchHost.swift:1266-1268`) only forwards the phase string to JS — it
stops no hardware.

**Fix:** native backstop — on `scenePhase == .background` end the workout unless
the app opted into background HR; add `deinit { stopAll() }` to `SensorBridge`.

---

## P1 — ongoing waste under normal use

### P1-1 · JS timers scheduled with zero leeway → watchOS cannot coalesce wakeups
`JSRuntime.swift:489-501`, esp. `owningQueue.asyncAfter(deadline: .now() + ms/1000, execute: work)` at `:498`.

Every `setTimeout`/`setInterval` maps 1:1 to a one-shot `asyncAfter`, which
carries **near-zero leeway**. watchOS batches deferrable timer fires into shared
CPU wake windows *only* when granted tolerance. With zero leeway, N concurrent JS
timers (React debounces/throttles/polls are pervasive) each wake the AP
independently and can't align with other system wakeups — the classic watch
power anti-pattern. This is the broadest ongoing cost in the runtime.

**Fix:** replace the `DispatchWorkItem` + `asyncAfter` with a per-id
`DispatchSourceTimer` scheduled via `.schedule(deadline:, leeway:)`, leeway
scaled to the interval (e.g. `~10%`, small floor, large cap for long timers).
Short animation timers keep tiny leeway (no jank); long debounces/polls get big
coalescing wins. `pendingTimers` type changes `DispatchWorkItem` →
`DispatchSourceTimer`; cancel/deinit stay the same.

### P1-2 · Widget timeline renders a full QJS boot on every cycle even when the stored payload is current
`ReactTimeline.swift:53-55` — `stored` is loaded, then `fresh = renderFreshTimelines(...)` is computed **unconditionally** before `newestPayload(stored, fresh)`.

The extension boots a fresh ~6MB QuickJS instance and evaluates the whole bundle
+ reconciles every widget on **every** `getTimeline`, then compares. This
contradicts the subsystem's own documented contract (`ReactTimeline.swift:10-15`,
`WidgetIntentRuntime.swift:40-41`: "decode and display … in-extension QJS is for
control intents and *stale* refreshes"). The 5s cache collapses only the
intra-burst multi-family fan-out; it does **not** span reload cycles. Whenever
the app already published a current, future-dated timeline (the Daypart/CX-016
design), the in-extension re-render reproduces data already in `stored` — pure
waste, and it is metered directly against battery + the WidgetKit refresh budget.
Frequency is WidgetKit-bounded (not per-second), so this is P1, not P0 — but it's
the widget subsystem's dominant avoidable cost and the best match for the "widget
made it worse" field report.

**Fix:** gate the fresh render on staleness. In `reactTimeline()` before `:54`:
if `stored` exists and still has a current/future entry
(`WidgetSnapshot.currentIndex`) within its reload horizon, use `stored` and skip
`renderFreshTimelines` entirely. Only render fresh when `stored` is missing or
its horizon is exhausted. Restores the documented "render only when stale"
behavior; also removes the per-tap double-boot (see P1-4).

### P1-3 · `publishWidgets` → `reloadAllTimelines()` has zero coalescing at every layer
`ReactWatchHost.swift:884-887` (native closure); mirror at `WidgetIntentRuntime.swift:85-89`; JS at `widgets.ts:222-235`.

The bridge closure calls `WidgetCenter.shared.reloadAllTimelines()`
synchronously and unconditionally on every JS `publishWidgets()`; the JS library
function is also un-throttled. The only debounce anywhere is hand-rolled in demo
code (`app.entry.tsx`). Any high-frequency publisher (a tap burst, a
subscription, a sensor handler) triggers a reload each time — and each reload is
the P1-2 full-bundle boot in the extension. `HydrationScreen.applyDelta` in the
example publishes on **every +/- tap** with no debounce.

**Fix:** trailing-edge coalescing in the **native** closure (the correct
boundary that covers the intent path too): `store.save` immediately, but
debounce `reloadAllTimelines()` behind a ~1–2s cancel-and-reschedule
`DispatchWorkItem` on main. The library should own this, not delegate it.

### P1-4 · Interactive-button/control tap boots QJS twice
`ReactWidgetButtonIntent.swift:26` / `ReactWidgets.swift:63-67` → `WidgetIntentRuntime.handle` (`:266-271`, boot #1) → handler's `publishWidgets` (`:85-89`) does `invalidateCache()` + `reloadAllTimelines()` → P1-2 cold path (boot #2) re-renders what boot #1 already published.

The P1-2 staleness gate fixes this for free: the post-tap reload then decodes the
handler's fresh payload instead of re-rendering it.

### P1-5 · Whole-tree SwiftUI re-render on every interaction tick
`NodeView.swift:39` (`@EnvironmentObject private var model`) — repeated on every node subview; model `ReactWatchHost.swift:30-45` (legacy `ObservableObject`, `@Published … optimistic`); continuous producer `NodeView.swift:1039-1045` (CrownRotation `set`).

Legacy `ObservableObject` has no per-property dependency tracking. Every
`dispatchOptimistic` (toggle/slider/stepper/**crown**/drag/date/text) mutates
`@Published optimistic` and fires `objectWillChange`; because every `NodeView`
holds `@EnvironmentObject model`, SwiftUI re-evaluates the body of the **whole
tree**, not just the changed node — and re-runs every per-render allocation
below (P1-6…P1-8) for every on-screen node. A crown rotation or slider drag emits
many sets/sec, so this is the P0-grade case under continuous Digital Crown/drag.

**Fix:** migrate the model to the Observation framework (`@Observable`) so a node
re-renders only when the value it reads changes; or inject per-node optimistic
values through a narrow `Equatable`/`Environment` slice so `objectWillChange`
doesn't fan out. (Larger change — schedule deliberately.)

### P1-6 · `isHandlerlessControl` allocates an 8-element `Set` for every node, every render
`NodeView.swift:69-75`, applied at `:49` (`.disabled(isHandlerlessControl)` in `body`).

`body` runs for every node; `.disabled` reads `isHandlerlessControl`, which
builds a fresh `Set<String>` literal (container alloc + 8 hashes) purely to test
`node.type` membership. Hottest possible path × the P1-5 amplifier. The set is a
compile-time constant. (Verified at 69-75 + 49.)

**Fix (trivial, one line):** hoist to
`private static let handlerlessControls: Set<String> = [...]`.

### P1-7 · `DateFormatter`/`NumberFormatter` allocated inside `body` per render
`RNFormat.swift:71` (`DateFormatter()`), `:91` (`NumberFormatter()`); call sites `NodeView.swift:106` (`FormattedText`) and widget `ReactWidgetView.swift:135`.

These ICU-backed formatters are among the most expensive Foundation objects to
construct; a fresh one is built and discarded on every `FormattedText` render,
in both the app and the widget, × the P1-5 amplifier.

**Fix:** use the value-type `FormatStyle` API
(`Date().formatted(.dateTime…)`, `value.formatted(.number/.percent/.currency)`),
or cache formatters in a `static` dictionary keyed by (locale, style, format).

### P1-8 · Base64 image decoded (and re-decoded) every render; no cache, no downsampling, no size cap
`NodeView.swift:371-376` — `Data(base64Encoded:)` + `UIImage(data:)` inside `imageView` inside `body`; widget mirror `ReactWidgetView.swift:139-141`.

Both the base64 decode and the `UIImage` build re-run every render (a new image
identity forces SwiftUI to re-rasterize); the bitmap is held at full source
resolution (`.frame` scales the view, not the backing store). × the P1-5
amplifier → an unrelated toggle re-decodes every on-screen image; large payloads
risk watch memory pressure.

**Fix:** decode once into a `static NSCache<NSString, UIImage>` keyed by the
base64 string; downsample to `side × screenScale` via
`CGImageSourceCreateThumbnailAtIndex`.

### P1-9 · No native teardown of motion/gyro/location on background
`ReactWatchHost.swift:1266-1268` (scenePhase forwards to JS only); streams stopped only by JS unsubscribe or reload.

A backgrounded app is **not** unmounted, so React `useEffect`/`useFocusEffect`
cleanups never fire on background — CoreMotion (10 Hz), gyro (10 Hz), and
continuous CoreLocation keep running while the user isn't looking at the watch.
Companion to P0-3.

**Fix:** in the scenePhase `onChange`, pause high-drain non-workout streams on
`.background` and resume on `.active`; provide a single native guardrail rather
than delegating teardown entirely to a JS lifecycle that doesn't fire on
background.

### P1-10 · Audio session left active on the decode-error path
`CapabilityBridges.swift:239-254` — `setActive(true)` at `:243`, `AVAudioPlayer(data:)` at `:244`, `catch` at `:251-253` has **no** `setActive(false)`.

On malformed audio the player init throws; the session stays active with no
player, so the audio route stays powered until the next reload. Happy paths
(`stop()` `:264`, `didFinishPlaying` `:271`) both deactivate correctly — only the
error path leaks.

**Fix:** `try? AVAudioSession.sharedInstance().setActive(false)` in the `catch`;
add a `deinit` to `AudioBridge`.

### P1-11 · Continuous location at best accuracy, no distance filter
`SensorBridge.swift:78-81` — `startUpdatingLocation()` (continuous), no `desiredAccuracy` (defaults to `kCLLocationAccuracyBest` → full GPS), no `distanceFilter` (callback on every micro-movement). Stopped only by JS/reload (P1-9). `allowsBackgroundLocationUpdates` is left false (good — can't self-run suspended).

**Fix:** expose/adopt a coarser default `desiredAccuracy` and a `distanceFilter`;
stop on `.background`.

### P1-12 · Default `bridge.log` does a synchronous `print` on the owning (main) queue, in release
`JSRuntime.swift:479` (`bridge.log = { print("[js]", $0) }`), not `#if DEBUG`-gated.

`print` takes the stdio lock + a synchronous `write` syscall on main, per JS log.
A stray `console.log` on a render/event/timer path becomes an ongoing main-thread
stall + I/O drain in production. `os` is already imported for boot logging.

**Fix:** default to an `os.Logger` (non-blocking, filterable) or gate the `print`
behind `#if DEBUG`.

---

## P2 — minor / conditional / cleanup

- **`reloadAfter` has no minimum floor** (`ReactTimeline.swift:71` native, `widgets.ts:177-179` JS). WidgetKit backstops the cadence so it can't hot-loop, but there's no defensive floor. Clamp to `max(date, now + ~15min)` at the policy site and warn (fail-loud) when the author's value was below the floor. (P1-2 makes each honored reload expensive, so this pairs with it.)
- **`scheduleBackgroundRefresh` has no minimum floor** (`ReactWatchHost.swift:1322`). OS-budgeted, but clamp `afterMs` to a sane minimum defensively.
- **Motion/gyro hardcoded to 10 Hz on `.main`, not JS-configurable** (`SensorBridge.swift:71,153`). Each reading runs the full JSON-encode→bridge→commit→decode pipeline. Deliver to a background queue + throttle; let JS pass an interval; default non-fitness to ≥0.2–0.5s.
- **Fresh `JSONDecoder()` per commit** (`ReactWatchHost.swift:841`). Reuse one instance on the model.
- **Bridge payload copied more than needed per event** (`JSRuntime.swift:348-351`, `406-411`): `String(data:)` + `JS_NewString` = extra copies; `JS_GetGlobalObject` retain/release per call; `var argv = args` forces a CoW. Use `JS_NewStringLen` from `Data`, pass `undefined`/cached global as `this`, take a non-mutating buffer.
- **Remote inspector `setInterval` (1 Hz) is not production-gated in code** (`inspector.ts:136-146`). Opt-in and never auto-started (examples grep clean), but a shipped `startInspector(...)` runs a 1 Hz O(tree) serialize + POST forever. Gate the body behind the `__devBuild` check already at `renderer.ts:286-287`; dedup byte-identical snapshots.
- **`wirePropsEqual` compares non-scalar props by identity** (`renderer.ts:76-79`). Inline `frame={{…}}` / `points={[…]}` props are never `Object.is`-equal → a redundant JS `serializeTree`+`stringify` each re-render. **Native side is still protected** (`renderer.ts:356` dedups byte-identical JSON — no native decode/SwiftUI invalidation). JS-CPU-only; fix via docs (hoist/`useMemo` inline props).
- **ms `TimerText` re-resolves style at 20 Hz** (`NodeView.swift:421-429`). The 50ms cadence is inherent to showing ms; re-running the `styled` color/font pipeline every tick is not. Resolve style once outside the `TimelineView` closure.
- **Per-render parses**: Chart points (`NodeView.swift:408-416`), Map annotations/route (`:512-517`), Button a11y subtree walk (`:319-338`), container `.filter`s (Grid `:170`, Toolbar `:1203-1209` ×3, NavStack `routeNodes` `:746-748`), TabView `Array(enumerated())` (`:237`). Memoize by node id + input hash, or push into `Equatable`-keyed subviews. × the P1-5 amplifier.
- **`@ScaledMetric pickerMinHeight` on every `NodeView`** (`NodeView.swift:42`) though only Pickers use it (`:228`) — adds a `sizeCategory` dependency tree-wide. Move into a dedicated `PickerNodeView`.
- **`SharedWidgetStore` re-decodes the whole payload per call** (`SharedWidgetStore.swift:34-40`), called 4× per timeline burst (`ReactTimeline.swift:53,83,98,110`); `UserDefaults(suiteName:)` reconstructed per access (`:20-23`). Decode once per burst and thread through.
- **`freshCache` is a single global not keyed by `appGroupId`** (`WidgetIntentRuntime.swift:329`, checked at `:283`) — a two-App-Group host can get the wrong group's cached payload within the 5s window. Correctness (battery-neutral). Key the cache by `appGroupId`.
- **ExtendedRuntime double-start can orphan a session** (`CapabilityBridges.swift:288-295`, guard only `state == .running`). Guard on `session != nil` or invalidate before replacing.
- **BLE connect-timeout doesn't cancel the in-flight connection** (`BluetoothBridge.swift:195-201`) — if the 15s timeout fires after `didDiscover`, `stopScan()` is a no-op and the pending `connect` keeps trying. Also `cancelPeripheralConnection` on timeout.
- **No `deinit` on any hardware bridge** (SensorBridge/BluetoothBridge/SpeechBridge/AudioBridge/ExtendedRuntimeBridge/ReactWatchModel). CoreMotion/CoreLocation self-stop on dealloc, but a live HKWorkoutSession and an active AVAudioSession do not. Add `deinit` calling the existing stop paths.
- **WatchConnectivity exposes only immediate `sendMessage`** (`PhoneConnectivity.swift:66-81`); no queued/coalesced `transferUserInfo`/`updateApplicationContext` for non-urgent bulk sync. API-completeness/hygiene.
- **`RNNode` deep `Equatable` / `JSONValue` decode cascade** (`WireModel.swift:14-32,47-75`) — conditional cost if used for per-commit diffing; reorder decode to common leaf types first.

---

## Verified clean (checked, correct for battery)

These were audited and confirmed good — worth stating so they're not
re-litigated:

- **Event loop is event-driven and bounded.** `drainJobs` (`JSRuntime.swift:557-575`) loops only while `JS_ExecutePendingJob` returns non-zero, runs only on the outermost JS-entry exit (`withJSEntry` `:546-555`), guarded against re-entrancy (`isDraining`). No busy-loop, no idle CPU wake, no native repeating/polling timer anywhere. Run-to-completion (M2) preserved.
- **No-op commit bailout — present at two levels.** L1 skip-serialize (`renderer.ts:320-324`, gated by `wirePropsEqual`) and L2 skip-native-send (`renderer.ts:356`, byte-identical JSON not sent → no native decode / SwiftUI invalidation). Value-identical sensor readings are fully bailed. This is the single most important structural win and it's done right.
- **No polling / no animation loop in JS or examples.** All ongoing state is native push (`registerNativeListener`); no `invoke`-on-a-schedule, no `setInterval` in examples, no `requestAnimationFrame` shim. `setInterval` shim floors re-arm to ≥4ms.
- **`invoke`/`fetch`/`ai` timer hygiene** — watchdogs cleared on settle, payload serialized before arming, no retry loops.
- **`TimerText` native ticking** (`NodeView.swift:430-441`, widget `ReactWidgetView.swift:381-397`) — `Text(timerInterval:)` ticks with zero per-frame JS/CPU; widget ms-mode deliberately degraded to avoid reload churn.
- **One-shot location** (`LocationBridge.swift:13-60`) — genuine `requestLocation()`, single callback, no continuous stream, released after settle.
- **BLE scan is filtered, no duplicates** (`BluetoothBridge.swift:240`) — service-UUID-filtered, `AllowDuplicates` off.
- **Reload teardown is comprehensive** (`ReactWatchHost.swift:226-240`) — stops sensors/audio/speech/extended-runtime + cancels fetches before the id space resets.
- **Weak-self everywhere; no retain cycles / runtime leaks** on hot paths; timer work items removed on fire/cancel/deinit.
- **Widget snapshot path doesn't spin QJS** (`ReactTimeline.swift:79-89`); intra-burst 5s cache collapses the multi-family fan-out to one bundle eval; bytecode preferred over source at cold start; epoch guard prevents mid-render clobber.
- **Commit equality guard** (`ReactWatchHost.swift:868`, `if root != tree.root`) skips SwiftUI re-diff on ack-only/value-identical commits.
- **`useFocusEffect`/`useIsFocused` provided** (`navigation.tsx:261-278`); sensors refcounted with idempotent cleanup. (The hazard: eager route mounting means a bare `useEffect` sensor subscription leaks the radio — documented, and the fix primitive ships. Examples don't trip it.)
- **DEBUG-only dev-server poll** (`ReactWatchHost.swift:1120-1143`) is entirely inside `#if DEBUG`.
- **Intent path publishes only on a real Storage write** (`intents.ts:36-48`), coalescing writes into one reload, zero budget on no-op intents.

---

## Implementation status (updated 2026-07-09)

Landed on `claude/watchos-perf-battery-review-ledrjq`. **No Swift toolchain was
available in the authoring environment**, so every Swift change is un-compiled
here; `SensorBridge`/`ReactWatchHost` are `#if os(watchOS)` and aren't even
covered by `swift test` on macOS — they need a device/simulator build. JS
changes are verified (typecheck + vitest).

| Finding | Status | Verification |
|---|---|---|
| P2 `reloadAfter` floor | ✅ done | JS: typecheck + widgets 15/15 |
| P1-6 `handlerlessControls` static | ✅ done | Swift, un-compiled |
| P1-10 audio session on error | ✅ done | Swift, un-compiled |
| P0-2 BLE stopScan + reconnect guard | ✅ done | Swift, un-compiled |
| P0-1 BLE bounded reconnect (5×60s, configurable) | ✅ done | JS: bluetooth 5/5 · Swift `BleSession` tests added (run on Mac) |
| P0-3 / P1-9 HR workout background teardown (+opt-in) | ✅ done | JS: sensors 9/9 · Swift watch-only (device build) |
| P1-1 timer leeway · P1-2/3/4 widget gate+debounce · P1-5 `@Observable` · P1-7/8 formatter/image cache | ⏳ not started | need a watch build loop |
| P1-11 location accuracy/filter · P2 batch | ⏳ not started | — |

**Design decisions taken:** BLE reconnect defaults to 5 attempts × 60s per
attempt, both tunable per `bleConnect` (`maxReconnectAttempts: 0` disables).
Background heart rate defaults to **stop on background**, opt-in via
`startHeartRate(handler, { keepAliveInBackground: true })`.

## Prioritized roadmap

Grouped by (impact × likelihood × fix cost). Each item is independently
shippable; the two behavior-changing groups (C, D) carry a design decision noted
inline.

**A. Safe, high-ROI, unambiguous — do first (localized, low risk):**
1. P1-6 — `isHandlerlessControl` `static let` (one line).
2. P0-2 — `stopScan()` in `disconnect()` + guard `didDiscover` (BLE stays hot / silent reconnect).
3. P1-10 — `setActive(false)` in the audio decode-error `catch`.
4. P1-12 — gate default `bridge.log` behind `#if DEBUG` / `os.Logger`.
5. P1-1 — timer leeway via `DispatchSourceTimer` (broad ongoing win).
6. P1-7 — cache/replace `DateFormatter`/`NumberFormatter` (app + widget).
7. P2 — `reloadAfter` floor + fail-loud warning; `JSONDecoder` reuse; `freshCache` keyed by `appGroupId`; `deinit` on hardware bridges.

**B. High-value, still localized:**
8. P1-8 — image decode cache + downsample (app + widget).
9. P1-3 — `publishWidgets` → `reloadAllTimelines` trailing debounce in the native closure.
10. P1-2 / P1-4 — widget staleness gate (skip fresh QJS render when `stored` is current). *Decision: this changes when the extension re-renders; confirm the "current entry within horizon" predicate matches the daypart design.*

**C. Radio-lifecycle policy — needs a product decision:**
11. P0-1 — bounded BLE reconnect (backoff + ceiling + terminal state).
12. P0-3 / P1-9 / P1-11 — native background teardown of HR-workout / motion / location. *Decision: stop-on-background by default vs. require an explicit `keepAliveInBackground` opt-in. Recommend: stop by default, opt-in to keep, since silent background HR is the worst-case drain.*

**D. Architectural — schedule deliberately:**
13. P1-5 — migrate `ReactWatchModel` to `@Observable` so interaction ticks re-render only the affected node, not the whole tree. Highest ceiling, largest blast radius; do with before/after Instruments traces.

**E. Cleanup (P2 batch):** motion rate config + background-queue delivery,
bridge marshaling copies, inspector production gate, per-render parse memoization,
`@ScaledMetric` scoping, `SharedWidgetStore` decode-once, ExtendedRuntime
double-start guard, BLE connect-timeout cancel, WatchConnectivity coalesced
transfer, `wirePropsEqual` docs.

None of these are measured on-device yet. Per `docs/performance-measurement.md`
§5/§7, land the safe batch (A), then attribute the change with an Energy trace on
a physical watch (`main` vs branch) before claiming a battery-life number.
