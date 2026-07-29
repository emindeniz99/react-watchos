# Budgets & limits

Every hard-coded cap, budget, and threshold in the project in one place: what it
is, where it's set, **who can change it** (a consumer DX knob vs a lib-internal
constant), the **real OS/hardware limit** behind it, and **how far we could
raise it**. Two framings to read the table with:

1. **Most of our numbers are tripwires/guards, not the OS ceiling.** watchOS
   enforces memory by **Jetsam on total process RSS**, a number Apple mostly
   doesn't publish and that bites *before* our per-subsystem sub-caps. So a cap
   like the 64 MB JS heap is a runaway-leak guard, not the budget you actually
   operate against — see [§ Heap caps](#heap-caps-are-guards-not-ceilings).
2. **"Who can change it"** is either **consumer** (a documented DX knob an app
   author sets) or **lib-internal** (baked into our Swift/config; changing it
   means editing this library). Only one row today is a true consumer knob.

## The table

| # | Limit | Our value | Set in | Who can change | Real OS / hardware limit | How high we could go |
|---|---|---|---|---|---|---|
| 1 | **App JS bundle** | 2 MB min (demo ~180 KB) | [`js/scripts/config.mjs`](../js/scripts/config.mjs) `budgetKB` | lib-internal (sanity ceiling) | none directly — cost is **flash + app heap + OTA**, not boot parse (prod ships bytecode) | the real ceiling is the **OTA cap (3 MB, #7)** — above it a bundle ships in the binary but can't be OTA-updated. Raised to 2 MB (2026-07-05): since prod ships `.qbc`, boot parse is a non-issue, so this is a loose sanity ceiling with OTA margin, not a tight tripwire. >3 MB needs raising `maxOTABundleBytes` too |
| 2 | **Widget JS bundle** | 1 MB min (demo ~146 KB) | `config.mjs` `budgetKB` | lib-internal (sanity ceiling) | the **~30 MB widget-extension RSS** is the real wall — [§ Widget memory](#widget-memory-the-30-mb-story) | kept **far tighter than the app**: the widget bytecode loads into the 16 MB widget heap (#4), so size trades against MEMORY. 1 MB ≈ 6% of the heap — safe; don't match the app's ceiling |
| 3 | **App QuickJS heap** | 64 MB | [`ReactWatchHost.swift:143`](../js/swift/Sources/ReactWatchHost/ReactWatchHost.swift#L143) `memoryLimitBytes` | lib-internal | watchOS **foreground Jetsam**, undocumented; historically **30 MB** (watchOS 3), raised since without a published figure | it's a **runaway guard**, likely already ≥ the whole app limit — see [§ Heap caps](#heap-caps-are-guards-not-ceilings) |
| 4 | **Widget QuickJS heap** | 16 MB | [`WidgetIntentRuntime.swift:64`](../js/swift/Sources/ReactWatchWidget/WidgetIntentRuntime.swift#L64) | lib-internal | **~30 MB** widget extension (iOS figure, best watchOS proxy) | conservative-but-tight; leaves ~14 MB for Swift + timeline snapshots. **Don't raise without on-device RSS measurement** |
| 5 | **embed-smoke heap gate** | 6 MB | [`tools/embed-smoke/run.sh`](../tools/embed-smoke/run.sh) `HEAP_BUDGET_MB` | lib-internal (CI tripwire) | n/a (dev tool) | baseline ~2.2 MB; raise only when a real feature legitimately grows the heap |
| 6 | **embed-smoke boot tripwire** | 250 ms | `run.sh` `BOOT_BUDGET_MS` | lib-internal (CI tripwire, **dev-hardware-relative**) | n/a (dev tool) | baseline ~40–46 ms; **retune** (don't tighten) when you consciously raise #1 |
| 7 | **OTA bundle max** | 3 MB | [`ReactWatchHost.swift:296`](../js/swift/Sources/ReactWatchHost/ReactWatchHost.swift#L296) `maxOTABundleBytes` | lib-internal | none — an **OOM guard** against a runaway OTA payload | raise cautiously; bounded by app RSS + download over the watch radio |
| 8 | **OTA boot attempts** | 3 | [`OTABootSequencer`](../js/swift/Sources/ReactWatchSupport/OTABootSequencer.swift) `maxBootAttempts` | lib-internal (could become a consumer knob) | n/a | rollback-to-shipped threshold; 3 is a sane default |
| 9 | **fetch body cap** | 5 MiB | [`FetchPlan.swift:68`](../js/swift/Sources/ReactWatchSupport/FetchPlan.swift#L68) `defaultMaxBodyBytes` | lib-internal (native-side default) | none — a **watch-network/memory guard** | raise for a specific large-download need; a huge body OOMs the app |
| 10 | **fetch timeout** | 120 s | [`fetch.ts:145`](../js/src/fetch.ts#L145) `DEFAULT_FETCH_TIMEOUT_MS` | **consumer** — per-request `{ timeout }`, `timeout: Infinity` opts out | none | the default is only the last-resort watchdog; apps set their own |
| 11 | **audio data cap** | 10 MB | [`CapabilityBridges.swift:197`](../js/swift/Sources/ReactWatchHost/CapabilityBridges.swift#L197) `maxAudioBytes` | lib-internal | none — a **memory guard** | raise for longer clips; trades against app RSS |
| 12 | **commit tree node budget** | 1000 nodes | [`js/src/budgets.ts`](../js/src/budgets.ts) `BUDGETS.maxNodes` (JS-side check; mirrored in [`BudgetPolicy.swift`](../js/swift/Sources/ReactWatchSupport/BudgetPolicy.swift)) | lib-internal (ARCH-13 tripwire) | none — a serialize/decode/SwiftUI-diff **cost tripwire** | it's a WARN, not a ceiling: crossing emits one `budget` diagnostic per crossing (hysteresis) and the commit still renders. A watch screen showing >1000 nodes is a design smell long before it's a crash |
| 13 | **commit JSON size budget** | 256 KB | `budgets.ts` `BUDGETS.maxCommitJSONBytes` (JS checks `json.length` post-stringify; native re-checks true UTF-8 bytes on the decode path via `BudgetPolicy`) | lib-internal (ARCH-13 tripwire) | none — bounds per-commit stringify/bridge/decode cost, ~10–20×/sec under sensors | WARN with hysteresis, commit still renders. Sits far under the OTA cap (#7); a payload here is per-commit, not per-install |
| 14 | **widget render time budget** | 500 ms | `budgets.ts` `BUDGETS.maxWidgetRenderMs` (enforced natively in [`WidgetIntentRuntime.swift`](../js/swift/Sources/ReactWatchWidget/WidgetIntentRuntime.swift) via `BudgetPolicy`) | lib-internal (ARCH-13 tripwire) | the **WidgetKit provider watchdog** (unpublished, seconds-scale) is the real wall | WARN to the Logger sink per breach — the early signal before the watchdog kills the extension silently. Tune against on-device timings once measured |
| 15 | **`transferFile` soft cap** | 1 MB | `budgets.ts` `BUDGETS.maxTransferFileBytes` (checked natively in [`PhoneConnectivity`](../js/swift/Sources/ReactWatchHost/PhoneConnectivity.swift) → `BudgetPolicy`) | lib-internal (ARCH-13 tripwire) | **none published** — Apple documents no byte cap for `WCSession.transferFile`, only that it throttles delivery "to accommodate performance and power concerns"; the real failures surface as `WCError.payloadTooLarge` / `.insufficientSpace` / `.transferTimedOut` | **this number is OURS, provisional and unmeasured.** WARN only: crossing it emits one `budget` diagnostic (hysteresis) and the file still transfers, because `WCError` is the authority on what is actually too large. Raise/lower it once the paired-device pass measures real transfer cost |

Only **#10 (fetch timeout)** is a real consumer knob today. Everything else is a
lib-internal guardrail; a consumer who genuinely needs a different value forks or
files an issue (and #8 is the obvious next candidate to promote to a knob).

#12–15 are the **ARCH-13 operating budgets**: breaches WARN — a recoverable
`budget`-subsystem diagnostic in the always-on ring (+ `console.warn` JS-side)
with once-per-crossing hysteresis — and never reject the commit (rejecting
would desync `ackedSeq`/optimistic state, CX-010). The numbers live in
`js/src/budgets.ts` (JS) and `BudgetPolicy.swift` defaults (native); change
them together, and update this table.

## JS bundle size — what it actually costs

Bundle size (#1, #2) is not an OS-enforced cap; it's a **cost tripwire**. On a
watch, three things scale with a bigger bundle, in order of what bites first:

- **Memory** (retained bytecode + heap) — the **first wall** on watchOS, per the
  memory research below.
- **Parse/compile** — scales ~linearly with source size. It *would* sit on the
  cold-start critical path (QuickJS is a no-JIT single-pass interpreter, parse is
  single-threaded — unlike V8 it can't hide parse on a worker thread,
  [QuickJS overview](https://blogs.igalia.com/compilers/2023/06/12/quickjs-an-overview-and-guide-to-adding-a-new-feature/))
  — **BUT the production build ships precompiled bytecode** (`build:bytecode` →
  `bundle.qbc`; `loadShipped` prefers it and only parses `bundle.js` as a
  fallback), so **at runtime parse is SKIPPED** — it's paid at BUILD time
  instead. Measured on the watch sim (2026-07-05): the app boots `bytecode
  (186 KB): read 1.8 ms + eval 45.4 ms` — a ~2 ms bytecode *read* replaces the
  ~44 ms parse. So a bigger bundle grows build-time parse + flash + a slightly
  larger bytecode `read`, **not boot parse**; boot is dominated by **eval** (the
  first React render + commit, which scales with the tree, not source size).
- **Download/flash IO** — scales with wire bytes.

  ⚠️ The **boot tripwire (#6)** runs the *source* (`bundle.js`) path, so it
  measures the fallback parse+eval — a useful source-size regression signal, but
  **not the prod boot cost** (prod = bytecode `read` + eval).

**Guidance we can lean on** (general low-end-mobile, no watch-specific number
exists): web.dev's budget is **~170 KB compressed / ~0.7 MB uncompressed** JS,
citing a **2–5× parse/compile spread between fastest and average phones**
([web.dev](https://web.dev/articles/optimizing-content-efficiency-javascript-startup-optimization)).
Treat Apple Watch as **≤ low-end phone** and expect **memory** to bite before
parse CPU. The highest-leverage lever if a bundle must grow: **precompile to
bytecode with `qjsc`** (`build:bytecode`) — it skips runtime parse entirely and,
mmap'd, cuts peak memory and flash IO, the analog of Hermes' AOT bytecode
([Hermes](https://engineering.fb.com/2019/07/12/android/hermes/)).

**So: to raise #1/#2, don't just bump the number.** Raise it, re-run the
embed-smoke **heap** and **boot** gates, and — because those run on dev hardware
— confirm real RSS on a device/simulator. See
[§ Raising a budget responsibly](#raising-a-budget-responsibly).

## Widget memory — the 30 MB story

The single number worth knowing, because it's the real ceiling behind #2 and #4.

- **iOS widget extensions are limited to 30 MB.** The primary evidence is the
  OS's own termination string —
  `EXC_RESOURCE RESOURCE_TYPE_MEMORY (limit=30 MB)` in a WidgetKit Jetsam crash
  ([Apple forums](https://developer.apple.com/forums/thread/713561)) — and Apple
  Feedback FB8832751, which states widgets get **30 MB total across the whole
  timeline, not per-entry**
  ([feedback-assistant #177](https://github.com/feedback-assistant/reports/issues/177)).
  It's enforced **only in release builds on a physical device** (not simulator /
  debug), which is why a widget can look fine in Xcode and get killed in the
  field.
- **watchOS has no published widget/complication memory number.** watchOS 9+
  complications use the **same WidgetKit timeline-provider infrastructure** as
  iOS
  ([Apple](https://developer.apple.com/documentation/widgetkit/creating-accessory-widgets-and-watch-complications)),
  so **iOS 30 MB is the best available proxy — but it's an inference, not a
  documented fact, and watchOS is more memory-constrained, so it could be
  lower.**
- **Our 16 MB widget JS-heap cap (#4) sits under that**, leaving ~14 MB for
  Swift + WidgetKit + the rendered timeline snapshots. That's workable but not
  generous; if the watchOS limit is actually below 30 MB, 16 MB of JS heap could
  be too aggressive. **Measure real extension RSS on-device before trusting it.**

(Historical footnote so nobody conflates them: the *legacy* iOS "Today" widget
had a 16 MB limit and old WatchKit apps a 30 MB *foreground* limit; those are
different mechanisms from the modern WidgetKit 30 MB. Legacy ClockKit
complications had no MB cap at all — they were governed by execution-time/update
budgets.)

## Heap caps are guards, not ceilings

The QuickJS heap caps (#3 64 MB app, #4 16 MB widget) are **runaway-leak
guards**, not the memory budget you operate against — because **watchOS Jetsam
acts on total process RSS**, which includes SwiftUI/UIKit, native buffers, and
the OS's own accounting, and which will kill the process *before* QuickJS's own
heap-limit throw fires.

- The **watchOS foreground app limit is undocumented.** The only hard number
  Apple ever stated was **30 MB on watchOS 3** (WWDC 2016 Session 227), and it
  was **raised in watchOS 4 with no replacement figure** (WWDC 2017 Session
  216). Modern watches (Series 9/10, Ultra) carry ~1 GB RAM, so the modern limit
  is believed higher — but **no source states a number**, and Apple explicitly
  says it's device/OS-dependent and that you should measure via a
  [Jetsam event report](https://developer.apple.com/documentation/xcode/identifying-high-memory-use-with-jetsam-event-reports).
- So **64 MB likely meets or exceeds the entire app limit** — it effectively
  never trips before Jetsam. Keep it as a defensive cap against a JS leak; don't
  read it as "we have 64 MB of JS to spend." Your real usable JS heap on-watch
  is realistically single-digits-to-low-tens of MB.
- The caps are **correctly ordered** (widget ≪ app) and correctly *shaped* (a
  guard). The action item is not to tune the numbers but to **measure on-device
  RSS** the day this ships to hardware.

## Raising a budget responsibly

When you consciously raise a size/memory budget (the common case is #1/#2):

1. **Bump the number** in its config location (see the table).
2. **Re-run the gates:** `pnpm build && bash ../tools/embed-smoke/run.sh` — both
   the heap (#5) and boot (#6) gates must still pass; **retune #6** if the raise
   legitimately moved boot time (it's dev-relative, so widen the tripwire rather
   than fighting it).
3. **Measure on a real device.** For memory, read real RSS for the affected
   process — the dev-machine gates can't see the watchOS Jetsam ceiling, and that
   ceiling is the only limit that actually kills you. For **cold-start parse
   cost**, `JSRuntime` logs the parse+eval wall-clock on every launch: open
   Console.app, filter subsystem `com.reactwatchos.runtime` category `boot`
   (`parse+eval bundle.js (N B): X.X ms`). The watchOS **simulator runs at Mac
   speed**, so only a physical **Series 9+** gives the true single-threaded
   number the bundle budget trades against — the embed-smoke boot tripwire (#6)
   is only a dev-relative regression signal, not that real number.
4. **Update this doc** — the value, and *why* it moved.

The point of #6 pairing #1 is exactly this: a bundle-size raise is only safe
once you've looked at what it did to cold-start, not just to the KB counter.
