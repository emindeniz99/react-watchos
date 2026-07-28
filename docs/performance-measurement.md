# Measuring performance & battery

How to actually measure this framework's cost — CPU, memory, render latency,
and energy/battery — instead of guessing. Written because "performance/battery
— not measured" kept showing up as an honest gap in the launch checklist.

Read this before making any perf claim in marketing or the README. A number you
didn't measure is a number you can't defend.

---

## 1. What "performance" means here

A screen update on this framework passes through three cost centers. They are
measured with **different tools**; conflating them is the most common mistake.

| # | Cost center | What runs | Where it runs | Measure with |
|---|-------------|-----------|---------------|--------------|
| 1 | **JS engine** | React render + reconcile + tree serialize + `JSON.stringify` | quickjs-ng, on the watch CPU | `tools/embed-smoke` (§3) |
| 2 | **The bridge** | JSON string copied JS→C→Swift, decoded to `RNNode` | QuickJS ↔ Swift boundary | `os_signpost` intervals (§4) |
| 3 | **Native render** | SwiftUI diff + layout + draw of the decoded tree | watchOS compositor | Instruments (§5) |

Energy/battery is not a fourth cost center — it is the **integral of 1+2+3 over
time**, plus radios (BLE, Wi-Fi, HealthKit). You reduce energy by reducing CPU
wakeups and work in each of the three, and by not holding sensors/timers open.
See §6.

Two structural facts that already bound our energy story (design decisions, not
measurements — but they are why the numbers below are small):

- **Timers tick in SwiftUI, not JS.** `<TimerText>` renders once and the watch
  animates the digits natively (`Text(timerInterval:)`); a running
  stopwatch/countdown costs **zero per-frame JS**. Anything that would otherwise
  spin a JS `setInterval` at display rate is the thing to hunt down first.
- **No-op commits bail before serializing** (NF-21/22): a render that produces
  an identical tree pays the `serializeTree + stringify` cost (§3, the
  `perSerializeStringifyMs` line) once to compare, then skips the bridge and the
  native re-render entirely.

---

## 2. The golden rule: engine numbers must come from quickjs, not V8

There are two benchmarks in this repo and only one is legitimate for a shipping
claim:

- `js/test/treediff.bench.test.tsx` runs under **vitest → V8 (JIT)**. Useful for
  relative A/B of two JS algorithms on your laptop. **Never** cite its
  absolute numbers for the watch — V8's JIT is nothing like the watch's
  bytecode interpreter.
- `tools/embed-smoke/bench.sh` runs the real demo bundle inside the **vendored
  quickjs-ng** via the reference C host — the *exact* interpreter the watch
  ships (`JSRuntime.swift` uses the same embedding sequence). These numbers are
  interpreter-representative. Still x86, not Apple silicon (§3 caveat), but the
  *engine* is right.

If someone quotes a per-commit millisecond figure, ask which harness produced
it. If the answer is vitest, it's marketing fiction.

---

## 3. Measure now, off-device: `tools/embed-smoke`

This is the one you can run today, on Linux/CI, with no Mac. It answers "how
heavy is cost center #1 (the JS engine)?" and "how much heap does the runtime
hold?".

```sh
cd tools/embed-smoke
./run.sh          # builds quickjs + the C host, runs the bundle once (smoke + [mem])
./bench.sh        # reuses the built host, runs the tree-commit benchmark
```

`run.sh` prints a memory line to stderr; `bench.sh` prints both that line and a
JSON summary. A real run on this repo's CI box (x86-64 Linux) right now:

```
[mem] quickjs heap: 6.4 MB, process peak rss: 10624 KB
{"engine":"vendored quickjs-ng via embed-host","demoTreeNodes":138,
 "fullTreeKB":11.5,"perDispatchMs":1.459,"perSerializeMs":0.539,
 "perSerializeStringifyMs":1.085,"dispatches":220}
```

*(2026-07-16 update: that sample predates ARCH-09 lazy navigation. The current
run on the same class of box: launch tree **48 nodes / 4.1 KB**, `perDispatchMs`
**~0.52**, quickjs heap **2.1 MB**, boot **39.9 ms** from source / **~13 ms**
from `.qbc` bytecode — and `run.sh` now gates both the source and the `.qbc`
production boot path. The old eager all-screens figures above (~138–152 nodes,
~1.3–1.5 ms) remain the right worst-case reference for a deep covered stack.)*

*(2026-07-28 update: re-measured after the ARCH-06 and watchOS-26 waves, and
this time for **every configuration the runtime actually boots** — two bundles
(ARCH-03 gave the widget extension its own, smaller one) × two boot paths.
Five runs each, one box:*

| Configuration | quickjs heap | boot, 5 runs |
|---|---|---|
| app bundle, source | 2.1 MB | 46.0–62.7 ms (parse 36–50 + eval 9.5–13) |
| app bundle, `.qbc` bytecode | 1.1 MB | 10.9–13.4 ms (read 1.5–2.2 + eval 9.4–11) |
| widget bundle, source | 1.7 MB | 30.9–33.4 ms (parse 30–32 + eval ~1.1) |
| widget bundle, `.qbc` bytecode | 0.7 MB | 2.2–2.4 ms (read ~1.3 + eval ~1.0) |

*Two things the older single number hid. **The heap is a per-configuration
fact, not one number**: the shipped app boots bytecode at 1.1 MB, and the
widget extension — the process watchOS is quickest to jetsam — holds 0.7 MB,
a third of the figure §7 used to quote. **Only the app rows are gated**;
`run.sh` never drives the widget bundle. Reproduce the widget rows with a
one-line epilogue (the second argument replaces the built-in smoke):*

```sh
echo 'JSON.stringify(Object.keys(JSON.parse(__renderWidgets()).widgets))' > /tmp/w.js
tools/embed-smoke/embed-host js/dist/widget.bundle.qbc /tmp/w.js
```

*`bench.sh` on the same box, three runs: launch tree unchanged at **48 nodes /
4.1 KB**, `perDispatchMs` **0.702 / 0.707 / 0.728**, `perSerializeMs` ~0.18,
`perSerializeStringifyMs` ~0.37, heap after the 220-dispatch burst 3.0 MB.
Set against the **0.518 ms** ARCH-09 recorded and the **0.559–0.668 ms** ARCH-06
recorded, that is a ~40% spread on an identical 48-node tree — same work,
different dev hardware, and the widest of it is boot wall-clock (the app-source
row above moves 17 ms run to run on one idle box). Read it as the operational
form of the caveat below: **compare a branch against `main` on ONE box in ONE
sitting.** A number from one build-log entry versus a number from another is not
a comparison, and no entry in this repo's history should be read as one.)*

What each field means:

| Field | Meaning | Why you care |
|-------|---------|--------------|
| `quickjs heap` | live JS heap after boot + a burst of commits (`JS_ComputeMemoryUsage`) | The runtime's steady-state footprint. watchOS jetsams greedy extensions; keep this well under the app's memory limit. |
| `process peak rss` | peak resident set of the whole host process | Upper bound incl. the engine binary + C host. Not the app's real RSS, but a sanity ceiling. |
| `demoTreeNodes` | node count of the demo tree the bench drives | Scales cost 1 & 3. (Until 2026-07-16 the demo eager-mounted *every* screen at once — the worst case; ARCH-09 lazy navigation now serializes only the active stack, so the launch tree is ~48 nodes.) |
| `fullTreeKB` | serialized size of one full commit | Scales cost #2 (bytes over the bridge). |
| `perDispatchMs` | **full pipeline** per tap: React render + full-tree serialize + `JSON.stringify` + C hop | The headline "cost of one interaction" on the engine side. |
| `perSerializeMs` | `serializeTree` only (no stringify) | Isolates the walk from the encode. |
| `perSerializeStringifyMs` | serialize + stringify | The per-commit JS cost the no-op bailout (§1) also pays. |

**The caveat that keeps you honest:** these are **x86-64** numbers. The Apple
Watch runs an S-series ARM core that is materially slower per-clock and
thermally constrained. Treat embed-smoke numbers as a **relative regression
gate** ("did this change make the tree walk 2× slower?") and a **rough order of
magnitude**, not as the number you print next to "on Apple Watch". The only
source for the latter is §5, on a real watch.

Good uses:
- **Regression gate in CI**: fail the build if `perDispatchMs` or `quickjs heap`
  jumps beyond a threshold on a fixed tree.
- **Before/after for a JS-side change**: run `bench.sh` on `main`, then on your
  branch, compare.
- **Memory ceiling check**: watch the `quickjs heap` line after adding a feature
  that retains data (caches, large lists).

---

## 4. Custom intervals on-device: `os_signpost`

`os_signpost` (framework `os`, `import os.signpost`) **is** available on watchOS
and is the right tool to time cost centers #2 and #3 in situ, and to see your
own spans inside an Instruments trace. It is not wired into the runtime yet;
this is the recommended shape when you need it.

```swift
import os.signpost

// One log per subsystem; "PointsOfInterest" surfaces in Instruments' timeline.
let perfLog = OSLog(subsystem: "com.yourapp.reactwatch", category: .pointsOfInterest)

func commit(_ json: String) {
    let id = OSSignpostID(log: perfLog)
    os_signpost(.begin, log: perfLog, name: "decode+render", signpostID: id)
    let node = try? decode(json)          // cost #2: bridge decode
    model.apply(node)                     // cost #3: hand to SwiftUI
    os_signpost(.end, log: perfLog, name: "decode+render", signpostID: id)
}
```

Then record with Instruments (§5) and add the **os_signpost** instrument, or
read intervals from the command line:

```sh
# On a Mac with a paired/attached watch:
xcrun xctrace record --template 'Time Profiler' \
  --device '<watch name>' --launch -- <app> && open *.trace
```

Signposts are near-free when no tracer is attached, so you can leave them in a
debug build. Wrap the JS side too — `performance.now()` exists in quickjs-ng
(monotonic) — to attribute time to render-vs-serialize on the actual device.

---

## 5. The real answer: Xcode Instruments on a physical watch

Simulators do not measure energy — the watch simulator runs on your Mac's CPU
and has no battery. **Every energy/thermal number must come from a real Apple
Watch**, paired and with Developer Mode on. This is the gate the launch
checklist is waiting on.

Attach Instruments to the watchOS app running on-device and use these templates:

| Instrument | Answers | Read |
|------------|---------|------|
| **Time Profiler** | Where is CPU time going? | Sample the call tree during a scroll/tap burst. Heavy `quickjs` frames → cost #1; heavy SwiftUI/`CoreGraphics` frames → cost #3. |
| **CPU Profiler / CPU counters** | How busy is the core? | Sustained high CPU is the #1 battery drain on-watch. Aim for idle between interactions. |
| **Allocations / Leaks** | Is memory growing unbounded? | Run the app through every screen repeatedly; the graph should return to baseline, not climb. Confirms the `quickjs heap` §3 number holds on-device. |
| **Animation Hitches** (SwiftUI/Core Animation) | Are frames dropping? | Hitches = the compositor missing the display deadline. On-watch this is felt as jank and burns energy re-rendering. |
| **Points of Interest** | Where are *my* spans? | Shows the §4 `os_signpost` intervals inline with the system trace. |

Method that actually produces a defensible battery figure:

1. Fully charge a real watch; note battery %.
2. Run a **fixed, scripted scenario** for a fixed wall-clock time (e.g. "open the
   app, run the stopwatch 10 min, navigate 3 screens") — same scenario every
   time so runs are comparable.
3. Note battery % after. The delta over the interval is your drain rate.
4. Repeat on `main` vs your branch to attribute a *change*. Absolute drain
   depends on watch model, brightness, and always-on display — so report it as
   "X% over N minutes on Series-Y under these settings", never a bare "great
   battery life".

For the "worst case", drive the scenario against the demo's **eager-mounted
all-screens tree** (§3, `demoTreeNodes`) — that is the heaviest tree the
framework produces. *(2026-07-16: ARCH-09 lazy navigation ended eager mounting —
the launch tree is now ~48 nodes. To reproduce a worst case, push a deep
multi-entry stack so every covered screen stays mounted and serialized.)*

---

## 6. Battery/energy specifically

There is one platform fact you must design around, verified against Apple's docs
(project rule: verify availability before assuming):

> **MetricKit is not available on watchOS.** Its `platforms` are iOS, iPadOS,
> Mac Catalyst, macOS, and visionOS —
> `developer.apple.com/tutorials/data/documentation/metrickit.json`.

So the pattern many iOS teams use — ship `MXMetricManager` and read
`MXMetricPayload.cpuMetrics` / `applicationLaunchMetrics` / `animationMetrics`
from the field — **does not run on the watch app**. You have two honest options
for field/battery telemetry:

1. **Instruments on a physical watch (§5)** — the primary, ground-truth tool for
   watch energy. No field aggregation, but exact.
2. **MetricKit in the paired iOS companion app** — MetricKit *does* run there, so
   any work you do on the phone side (the Expo companion, WatchConnectivity
   handling) can be measured with `MXMetricPayload` in that target. It just tells
   you nothing about on-watch CPU.

Energy checklist for this framework specifically — the things most likely to
drain a watch battery, in priority order:

- [ ] **No JS timer running at display rate.** Use `<TimerText>` (native ticking)
      for any counting UI. A `setInterval` re-rendering the tree every frame is
      the worst thing you can do here. Grep your app for `setInterval`.
- [ ] **Sensors/streams are closed on blur.** Subscribe to HealthKit/BLE/motion
      inside `useFocusEffect` (not a bare `useEffect`), so leaving the screen
      releases the radio. A stuck heart-rate stream keeps the sensor hot.
- [ ] **No busy-loop polling over the bridge.** Prefer native push events
      (`registerNativeListener`) to JS timers that call `invoke` on a schedule.
- [ ] **Background refresh is rate-limited.** watchOS budgets background wakeups;
      don't schedule aggressive refreshes.
- [ ] **Commits are actually distinct.** Confirm the no-op bailout (§1) is doing
      its job — an app that re-renders an identical tree on every state tick pays
      the serialize cost for nothing. Watch `perDispatchMs` × your commit rate.
- [ ] **Extended runtime sessions are scoped.** An `WKExtendedRuntimeSession`
      keeps the app alive (and drawing) — only hold one for the workout/task that
      needs it, and end it promptly.

---

## 7. What we can and can't claim today

Honest status, so nobody over-claims in marketing (updated 2026-07-28; the
2026-07-16 wording is superseded, not deleted — the numbers it quoted are still
in §3 as that date's sample):

- ✅ **Engine cost & heap**: measured, reproducibly, via `tools/embed-smoke`
  (§3), and **partly gated** — `run.sh` fails on heap > 6 MB or boot > 250 ms on
  the source path, and separately gates the `.qbc` production boot path on
  loading + handling the interaction. `bench.sh` runs in CI but **gates
  nothing**: `perDispatchMs` is recorded, never thresholded (see the variance
  note below for why a threshold would have to be very loose), and neither
  widget-bundle row in §3 is driven at all. The defensible sentence, as of the
  §3 re-measure:
  "a full interaction commit is **0.5–0.75 ms** of engine work on an x86 dev box
  over the demo's 48-node lazy launch tree (~1.3 ms over the old eager 152-node
  tree — the worst-case reference); the QuickJS heap is **0.7–2.1 MB depending
  on which bundle and which boot path**, lowest in the widget extension; cold
  boot is **~46–63 ms from source and ~11–13 ms from bytecode** for the app,
  **~31 ms / ~2.4 ms** for the widget" — with the x86 caveat stated. Quote the
  RANGE, not a point. The three `perDispatchMs` figures in this repo's build log
  — **0.52** (ARCH-09), **0.56–0.67** (ARCH-06), **0.70–0.73** (today) — are the
  same 48-node / 4.1 KB tree each time, with no bench-visible change landing
  between them, so the drift is session/host variance rather than a tracked
  regression. State that plainly rather than pick the flattering one, and note
  what it implies: **a real regression smaller than ~40% would not be
  distinguishable across sessions by this harness.** Only a same-box A/B is.
  The old "~0.5 ms / ~2 MB / ~40 ms" shorthand read as more precision than any
  of that supports.
- ✅ **Structural energy wins**: native timer ticking and the no-op-commit
  bailout are real, tested behaviors (design facts, §1) — joined since the
  2026-07-08 audit by timer leeway (wake coalescing), the widget staleness gate
  + reload debounce, background HR/sensor teardown, bounded BLE reconnect,
  ARCH-09 lazy navigation (the 152→48-node launch tree above), and since
  2026-07-27/28 the ARCH-06 revision binding + `WidgetPublishGate`, which skips
  the `WidgetCenter` wake when a republish changes nothing but `publishedAt`.
  The relevance clues shipped on 2026-07-28 belong here too and are the only
  strictly battery-POSITIVE item in that wave: they are metadata for the
  on-device ranker — a few bytes at render time, zero wakeups at surface time —
  and better surfacing removes the expensive "raise wrist, don't find it, open
  the app" path. All of it is still design facts + engine numbers. **None of it
  has been weighed on a wrist.**
- ✅ **Swift-side logic on Linux**: since 2026-07-09 the SwiftPM package
  compiles and `swift test`s on Linux (**308 green as of 2026-07-28**, up from
  227) — the engine embedding runs against the real vendored quickjs-ng. That is
  *logic* coverage; it says nothing about SwiftUI rendering or watch hardware.
- ❌ **On-watch CPU %, frame rate, and battery drain**: **still not measured.**
  Nothing in the last three waves changed this, and no amount of Linux green
  will. Do not print a battery-life number until the §5 run exists.

### The on-watch debts, and who owns each

Every row below is blocked on hardware or Xcode, not on more code. Naming the
owner is the point — an unowned debt reads as an oversight.

| Debt | Needs | Owner |
|---|---|---|
| **Battery drain** — the §5 scripted-scenario run: charge a real watch, run a fixed scenario for a fixed wall-clock, record % delta, watch model, OS version, brightness/always-on settings | A physical Apple Watch with Developer Mode on | **The repo owner — user-owed, plainly.** No agent, no CI runner, and no simulator can produce this; it is the single gate the launch checklist waits on, and it will not clear itself. Note what this is *not* blocked on: the app already **boots and renders on a physical Ultra 3** (status.md, 2026-07-05, watchOS 26.5, properly signed). The hardware exists and the app runs on it. What has never happened is the instrumented, scripted, timed session — a different activity from "I ran it on my wrist", and the only one that produces a number. |
| **CPU %, frame rate, hitches** — Time Profiler / Animation Hitches on-device | Same watch + Instruments | Same. Cheap to collect in the same session as the battery run; do them together, along with the other hardware-only validations status.md still lists (haptic feel, Crown feel, HealthKit HR + GPS streams, a complication on the live face). |
| **Liquid Glass eyeball (WA26-A3)** — rebuild the watch scheme against the Xcode-26 SDK and look at `List`/`Button`/`NavigationStack`/`TabView`, and at anything reading `theme.radius`/`theme.space`. The reskin arrives without an SDK rebuild, but Apple's "don't hard-code layout metrics" caveat lands squarely on `defaultTheme` — which does hard-code them | A Mac with Xcode 26 | Whoever does the next Mac build. Declined-with-trigger for *more* glass API (WA26-D1); this row is only the look-at-it. |
| **Relevance surfacing (WA26-C7)** — does the Smart Stack actually surface on the clues `relevantContexts` publishes? | A real watch, worn, over days | **Permanently ③ / device-only.** There is no simulator or unit test for an on-device ranker's decision. Saying so beats claiming it. |
| **Control toggle behavior (WA26-B3)** — the `ControlWidgetToggle` drawing and flipping in Control Center | watchOS simulator (`pnpm test:swift:watch`) | Next Mac session. The JS↔wire round trip is already pinned in qjs-smoke; what's unproven is the OS-side widget. |
| **Navigation transition latency (ARCH-09)** — confirm-then-animate adds a JS round trip before the push animates; the *feel* is unmeasured | Real watch (a simulator's timings are the Mac's) | Same session as the battery run — it is the same scripted scenario. |
| **RelevanceKit/MapKit compile (WA26-C6)** — `reactRelevantContext`'s switch is `swiftc -parse` + review on Linux; the watchOS build is the real gate | A Mac with the watchOS SDK | Next Mac build. |

When the §5 device run happens, record its scenario, watch model, OS version,
and numbers here so the claim is traceable — and delete the corresponding row
above rather than leaving it to rot.
