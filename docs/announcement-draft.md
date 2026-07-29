# Announcement draft (pre-marketing copy)

Working copy for the launch post. Written against the claims-discipline list
in [launch-checklist.md](./launch-checklist.md) §4 — every number cites its
source. Gate E3 cleared on 2026-07-05 at a **stated scope**: the app boots
and renders on a physical Apple Watch Ultra 3, properly signed. Device claims
here are held to exactly that scope — haptics, Digital Crown feel,
HealthKit/GPS streams and the live-face complication remain unverified on
hardware. Update the bracketed gates before publishing; do not publish while
any bracket remains.

**Refreshed 2026-07-29** against the current tree: this draft predated the
HEALTH, WORKOUT-PLANS and PLATFORM-DATA waves, so the capability list, the
gate numbers and the perf figures were all describing a smaller project. The
positioning also changed: **lead with what the watch is actually used for —
the face and the Smart Stack — then standalone execution, then health depth,
then signed OTA.** Architecture is the third paragraph, not the first.

**The stated next milestone is L1: submit a real app to App Review with the
OTA machinery present in the reviewed binary.** Everything in the OTA section
below is a design claim until that comes back. Say so; do not argue the
guideline in prose.

---

## Short post (X / HN / r/reactnative)

> **react-watchos — write Apple Watch apps in React, running ON the
> watch.**
>
> JSX + hooks render real SwiftUI. No phone round-trip: QuickJS runs on the
> watch itself, so the app is standalone — its own network, its own APNs
> token, its own storage.
>
> Complications and Smart Stack widgets are React-authored: your app's React
> renders the WidgetKit timelines, and the widget extension embeds its own
> engine so a Control Center button can update them with the app closed.
>
> Health goes past a heart-rate demo: HealthKit reads (steps, energy, sleep,
> SpO2 — a week of daily buckets in one query), real workout sessions that
> save an `HKWorkout` with a route, and WorkoutKit plans composed in
> TypeScript.
>
> OTA updates to the JS half are Ed25519-signed with anti-rollback and
> crash-loop rollback — and unsigned updates are refused by default.
>
> Not a React Native fork (that's impossible on watchOS — no public UIKit,
> no JavaScriptCore); it's the same *category*: a custom reconciler
> streaming JSON trees to a native interpreter, the architecture Raycast
> validated at scale.
>
> npm i react-watchos → Expo config plugin wires the Xcode targets.
> [link]

HN title options (pick one, don't oversell):
- "React for watchOS: JSX driving native SwiftUI, with the JS engine on the watch"
- "Show HN: Write Apple Watch apps in React (QuickJS + SwiftUI, no phone required)"

Post to HN, r/reactnative and the RN Discord. Calibrate expectations: a watch
runtime is a narrow audience, and the comparable prior art sits in the low
hundreds of downloads a month. Decide what success means *before* posting —
[the checklist's §5 order of operations](./launch-checklist.md) is the frame,
and "one real third-party app shipped on it" is a better goal than a download
count.

## Blog-post outline

1. **The hook** — the counter demo GIF (simulator capture; say so in the
   caption — the on-wrist run of the same stack is real but wasn't filmed).
   "This is React 19, running in QuickJS, on the watch, rendering native
   SwiftUI."
2. **Where watch value actually lives now** — the face and the Smart Stack,
   not the app grid. Show the hydration complication updating from the app,
   then the same thing updating from a Control Center button **with the app
   closed**. The point to land: the widget stack is fully bound here — all 8
   RelevanceKit clue families, Controls, and payload provenance
   (`stateRevision` + `releaseId`) so a widget can tell fresh from stale.
3. **Why a fork was impossible** — the research.md table (no public UIKit,
   no JSC, no JIT). What we built instead: reconciler → JSON tree →
   SwiftUI interpreter, events + seq-ack back. A ~570-line renderer core, not
   a framework fork.
4. **Why QuickJS and not Hermes** — the argument that stops "why a second
   engine?" dead: Hermes has no watchOS target **and no ILP32 story**, while
   pre-S9 watches are `arm64_32` (64-bit registers, 32-bit pointers). A port
   would drop those watches or fund an ILP32 port of a JIT-less VM — for a
   gain whose AOT half `build:bytecode` already delivers. (Link the README
   section; the full analysis is the 2026-07-01 review §2.1.)
5. **The parts that surprised us** (each links to docs):
   - React-authored complications: the app's React renders WidgetKit
     timelines; the widget extension embeds its own QuickJS (~6 MB measured
     peak vs a ~30 MB budget) for Control-Center intents with the app closed.
   - Health without a fake workout: HealthKit statistics/sample queries, a
     week of daily buckets from one `HKStatisticsCollectionQueryDescriptor`,
     and real workout control that saves the `HKWorkout` — plus WorkoutKit
     plans handed to Apple's Workout app. The honesty mechanism is worth the
     paragraph: WorkoutKit's mutators are non-throwing and return nothing, so
     every mutation is **verified by reading it back** before the promise
     settles.
   - `TimerText`: high-frequency UI is never driven from JS — hand SwiftUI
     the declarative target and let it tick natively.
   - Signed OTA: Ed25519 with the keyId inside the signed bytes,
     anti-rollback, crash-loop rollback to known-good, boot-time
     re-verification — and refusal as the zero-config default. Capability
     bounded: the `__host` surface is fixed in the binary and a `HostPolicy`
     allowlist can narrow it further, so a bundle can never *gain* native
     reach.
   - The design system: 41 primitives + shared modifier props
     (padding/frame/background/…, per-node animation) + a token/theme layer
     that resolves in JS so the native side never sees a token.
6. **Numbers** (sources in launch-checklist §4 — re-derive the day you
   publish). Quote the **range**, not a point, and say "x86" every time:
   "a full interaction commit is **0.5–0.75 ms** of engine work on an x86 dev
   box over the demo's 48-node lazy launch tree (~1.3 ms over the old eager
   152-node tree); the QuickJS heap is **0.7–2.1 MB** depending on bundle and
   boot path; cold boot is **~46–63 ms from source, ~11–13 ms from bytecode**"
   ([performance-measurement.md](./performance-measurement.md) — that sentence
   is the repo's own defensible phrasing). Bundle sizes: **191 KB minified**
   app / **149 KB** widget, against 2 MB / 1 MB budgets (`pnpm check:size`,
   2026-07-29). Gates: **`swift test` 374** and **640 vitest tests** green
   locally. [E4: replace the dispatch figure with an on-device number when it
   exists — until then the x86 caveat is mandatory, and note that this harness
   cannot distinguish a regression smaller than ~40% across sessions.]
7. **The honest list** — link README Limitations and status.md verbatim:
   not RN core, no RN ecosystem libraries, physical-device path verified to
   "boots + renders" only (haptics, crown, HealthKit/GPS streams and the
   live-face complication untested on hardware), WatchConnectivity file
   transfer unverifiable on a simulator by Apple's own docs, on-device AI
   blocked on the watchOS 27 SDK, Suspense unsupported by design, and **CI has
   never run** (Actions disabled at the repo level — the gates are local).
8. **When not to use it** — link the README section. Naming the five
   disqualifiers (no custom native views, pure-sensor apps, Swift-native
   teams, one-codebase-for-phone-and-watch, zero App-Review risk tolerance)
   buys more credibility than any feature paragraph.
9. **Try it** — quickstart ([getting-started.md](./getting-started.md)),
   examples, and the architecture review for the deep readers.

## FAQ (prewritten answers for the comment section)

**"Is this React Native?"** In spirit; in code, no — and the README says so
in its second section. No RN core code, no RN ecosystem libraries, no
Yoga. A true port is impossible on watchOS; here's the dependency table
(link research.md).

**"Isn't shipping a JS interpreter against App Store rules?"** Interpreting
JS **bundled with the app** is ordinary and permitted; our OTA policy
restricts updates to already-reviewed functionality, because the native
`__host` surface is fixed in the reviewed binary and a bundle cannot gain
native capability. **We have not been through App Review yet** — that
submission is the next milestone, and it is the only thing that will actually
settle this. Link [ota-signing.md](./ota-signing.md) for the design and stop
there. [Gate S4 / L1: do not claim "App Store approved"; do not argue the
guideline in the thread — a reviewer's approval is evidence, your reading is
not.]

**"What about performance without JIT?"** Apple forbids JIT for everyone —
native apps and us alike. The renderer is pull-driven (idle = zero work),
commits skip serialization when nothing wire-visible changed, high-
frequency UI is delegated to native (`TimerText`), and the React Compiler
is on by default in the build preset. Measured pipeline cost: 0.5–0.75 ms per
interaction on **x86** quickjs-ng [E4: on-device number pending].

**"How deep does the health support go?"** Reads: steps, active energy,
distance, SpO2, sleep stages, plus daily buckets for a week in one query.
Writes/sessions: a real `HKWorkoutSession` with pause/resume, live metrics,
an optional GPS route, and a saved `HKWorkout`. Plans: compose a custom,
single-goal or pacer workout in TypeScript, hand it to Apple's Workout app,
schedule/list/remove it. Honest scope: **the health and workout bridges are
watchOS-only code that Linux cannot compile and the simulator signs without
the HealthKit entitlement, so they are ③-owed on device** — status.md marks
each row. Say that plainly if asked; it is the same discipline as the E3
scope.

**"OTA = remote code execution?"** Only if you misconfigure it on purpose:
unsigned updates are refused unless you explicitly opt in for dev builds;
production requires Ed25519 keys baked into the code-signed binary, the
keyId is inside the signed bytes, downgrades are refused, a crash-looping
bundle rolls back, and stored bundles re-verify at every boot. A `HostPolicy`
allowlist can narrow what any bundle may reach. Threat model, including what
an attacker who controls the manifest URL can and cannot do, is documented
(link ota-signing.md).

**"Why not SolidJS / signals?"** We evaluated it seriously (link the
2026-07-01 review §2.2). Short version: the expensive part is the wire
protocol, not React — the reconciler already exposes the mutation stream a
patch protocol needs, and Raycast ships React + JSON-patch at scale. The
protocol seam is where that evolution happens, without changing the
product's API.

**"Does it work on a real watch?"** "Yes, at a scope we'll state exactly: on
2026-07-05 it ran on a physical Apple Watch Ultra 3 (watchOS 26.5), properly
automatic-signed against a real team with the App Group provisioned by the
portal — the QuickJS + renderer → SwiftUI stack boots and renders on-wrist.
What we have NOT verified on hardware: Taptic haptics, Digital Crown feel,
the HealthKit heart-rate and GPS location streams, a complication on the live
watch face, and BLE against a real peripheral. Everything else is simulator +
package tests on the watch arch." Do not soften this answer, and do not round
"boots + renders" up to "works".

**"How do I debug it?"** There is a written answer, which is the point:
[debugging.md](./debugging.md) — the on-wrist shapes (full-screen boot
failure vs dismissible banner), structured diagnostics with a session and
release id, `componentStack` from `ErrorBoundary`, Console.app streams, a
remote tree/log/error inspector, and the local `qjs` repro loop. And the gap,
stated first rather than discovered: **no React DevTools** — its backend
needs a WebSocket transport QuickJS doesn't have and watchOS can't lend it.

## Claims we do not make

Standing rules for this launch; each one has a reason, and breaking one costs
more credibility than the claim buys.

- **No "battery-first" headline.** It is unverifiable to the reader and it is
  exactly what a skeptic assumes is false about an interpreter on a wrist.
  Battery is a *defensive* claim — the defaults are the safe ones, and
  `onLuminanceReduced` lets an Always-On app stop ticking — plus a feature
  claim via sanctioned background execution (real workout sessions). Never a
  benchmark.
- **No adoption or user-satisfaction statistics.** In particular, the pair of
  watch-user dissatisfaction / app-abandonment percentages that circulates in
  blog posts traces to an unsourced content farm — the figures are not
  repeated here even to disown them, because the way they spread is by being
  quoted. Using one such number once destroys the credibility the rest of
  this repo earned.
- **No "App Store approved"** until there is a receipt (L1 / gate S4).
- **No device claim beyond "boots + renders"** (E3).
- **No perf number without "x86"** until E4 clears.
- **No commerce, social-feed, chat, ride-hailing, video or game demos.** Every
  one of those categories has a famous corpse on this platform; a shopping
  demo in the README signals you haven't studied it. Demo what the watch is
  for: glanceable state, a workout, a timer, a complication.
- **Don't lead with the architecture diagram.** It is the third paragraph.
  The first is what the thing does for the person reading.

## Assets to produce before publishing (checklist §4)

- [ ] Counter/hydration demo GIF (simulator capture)
- [ ] Complication updating from the app (gauge fill)
- [ ] Control Center intent with the app closed
- [ ] Dev hot-reload loop (edit App.tsx → simulator updates)
- [ ] Stopwatch (`TimerText`) — emphasize zero per-frame JS
- [ ] A workout screen: start → live metrics → end → the saved `HKWorkout`
      (simulator capture; label it, since health is device-owed)
