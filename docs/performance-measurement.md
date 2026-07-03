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

What each field means:

| Field | Meaning | Why you care |
|-------|---------|--------------|
| `quickjs heap` | live JS heap after boot + a burst of commits (`JS_ComputeMemoryUsage`) | The runtime's steady-state footprint. watchOS jetsams greedy extensions; keep this well under the app's memory limit. |
| `process peak rss` | peak resident set of the whole host process | Upper bound incl. the engine binary + C host. Not the app's real RSS, but a sanity ceiling. |
| `demoTreeNodes` | node count of the eager-mounted all-screens demo tree | Scales cost 1 & 3. The demo mounts *every* screen at once (worst case). |
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
framework produces.

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

Honest status, so nobody over-claims in marketing:

- ✅ **Engine cost & heap**: measured, reproducibly, via `tools/embed-smoke`
  (§3). We can say "a full interaction commit is ~1–1.5 ms of engine work on an
  x86 dev box over a 138-node tree; the QuickJS heap sits around 6 MB" — with the
  x86-caveat stated.
- ✅ **Structural energy wins**: native timer ticking and the no-op-commit
  bailout are real, tested behaviors (design facts, §1).
- ❌ **On-watch CPU %, frame rate, and battery drain**: **not yet measured** —
  these need §5 on a physical Apple Watch, which is the open gate. Do not print a
  battery-life number until that run exists.

When the §5 device run happens, record its scenario, watch model, OS version,
and numbers here so the claim is traceable.
