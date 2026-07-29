# react-watchos

Write Apple Watch UI in React — JSX, hooks, state — rendered as **native
SwiftUI**, with the JS engine running **on the watch itself**. The app is
standalone: it installs, runs, and updates its UI without the iPhone.

```tsx
function App() {
  const [count, setCount] = useState(0);
  return (
    <VStack spacing={6}>
      <Text size={24} bold>Count: {count}</Text>
      <Button onPress={() => setCount((c) => c + 1)}>
        <Text>+</Text>
      </Button>
    </VStack>
  );
}
```

> **Pre-1.0. Nothing has shipped to the App Store yet.** The stack boots and
> renders on a physical Apple Watch (2026-07-05, Ultra 3, watchOS 26.5,
> properly signed) — that is the verified scope; everything else is
> simulator-grade or Linux-tested. Per-capability evidence levels live in
> [docs/status.md](./docs/status.md), which is the authority whenever another
> doc says "shipped".

## What it's for

Four reasons to pick this over writing SwiftUI by hand, in the order they
actually matter:

1. **The complication is the product, and it's fully bound.** Watch usage
   has moved from the app grid to the face and the Smart Stack. Here the
   *app's React* renders WidgetKit timelines — including future-dated entries
   and Smart Stack relevance clues (all 8 RelevanceKit families) — and the
   widget extension embeds its own QuickJS, so a Control Center button or an
   AppIntent can update shared state and republish **with the app closed**.
   Payloads carry provenance (`stateRevision` + `releaseId`), so a widget can
   tell fresh data from stale.
2. **It runs without the phone.** Standalone by default
   (`WKRunsIndependentlyOfCompanionApp`), `fetch` over the watch's own radio,
   the watch's own APNs token, App-Group storage shared with the widget. The
   iPhone is an option, not a dependency.
3. **Health goes deeper than a heart-rate demo.** HealthKit reads (steps,
   active energy, distance, SpO2, sleep stages — and a whole week's daily
   buckets in *one* query), real workout control that saves an `HKWorkout`
   with live metrics and an optional GPS route, and WorkoutKit plans you can
   compose in TypeScript and hand to Apple's Workout app.
4. **The JS half updates over the air, signed.** Ed25519 with the keyId inside
   the signed bytes, anti-rollback, crash-loop rollback to known-good,
   re-verification at every boot — and unsigned updates refused by default.
   An OTA bundle can never gain native capability: the `__host` surface is
   fixed in the reviewed binary and a `HostPolicy` allowlist can narrow it
   further. **Untested against App Review so far** — see
   [docs/ota-signing.md](./docs/ota-signing.md) for the design and
   [docs/launch-checklist.md](./docs/launch-checklist.md) for the honest gate.

And one defensive claim, not a headline: **the defaults are the battery-safe
ones.** Heart rate stops in the background, sensors default to low rates,
BLE reconnect is bounded, timers carry leeway, widget reloads coalesce, and
`onLuminanceReduced` tells you when the wrist is down so you can stop ticking.
That is policy, not a benchmark — **every performance number we can quote
today is from x86 quickjs-ng, not a watch**
([docs/performance-measurement.md](./docs/performance-measurement.md) §7 says
exactly what is and isn't claimable).

## Is this React Native?

In spirit, yes; in code, no. React Native = React + a native host platform
(Yoga layout, the Fabric renderer mapping the tree to UIKit/Android views,
JSI/TurboModules, Metro, `<View>`/`<Text>`/StyleSheet). A true RN port is
impossible on watchOS — there is no public UIKit and no JavaScriptCore for
Fabric/Hermes to attach to, which is why react-native-tvos exists but no
watch equivalent does ([docs/research.md](./docs/research.md) has the full
analysis).

This project does the same *category* of thing with ~500 lines instead of a
framework fork: a JS engine on the device, JSX + hooks driving real native
widgets, events bridged back to JS. It shares no code with RN core — **RN
ecosystem libraries won't run here** — and the component vocabulary is
SwiftUI-like (41 primitives, `VStack`/`List`/`Gauge`/`Chart`/`NavigationStack`
and the rest), with SwiftUI layout rather than flexbox.

## Why QuickJS, and not Hermes

The fair question: shipping a second JS engine looks like gratuitous risk when
React Native already has one. The short answer is that **Hermes has no watchOS
target and no ILP32 story**, and that second half is the load-bearing one.

Apple Watch models before S9 run **`arm64_32`** — 64-bit registers, 32-bit
pointers. quickjs-ng is plain portable C that compiles for `arm64_32` today
(and for `arm64`, and for your Linux CI box, which is why the production
bundle is testable in the exact target engine). Hermes has no ILP32 support
story, so a Hermes port would either **drop every pre-S9 watch** or fund an
ILP32 port of a JIT-less VM — to gain AOT bytecode and a better GC, and we
already have the first half: `build:bytecode` precompiles the bundle to
QuickJS bytecode so cold start skips the parser.

The other candidates fail earlier. **JavaScriptCore** isn't shipped on
watchOS at all, and a static WebKit build is enormous — with no JIT allowed,
JSC loses most of its advantage anyway. **Moddable XS** is technically
excellent but LGPLv3: on a signed, statically-linked App Store binary the
relinking obligation has no clean discharge, and because this is an npm
package that obligation would flow to **every consumer's app**. quickjs-ng is
MIT; consumers inherit nothing.

Residual risks, named rather than waved away: `.qbc` bytecode is coupled to
the vendored engine version (mitigated by hash-refusal and regenerating at
package time), quickjs-ng is a community fork of Bellard's QuickJS (the
vendoring script isolates us from either's churn), and there is no JIT —
which is not a differentiator, because Apple forbids JIT for everyone.

Full analysis, including what a migration would actually cost:
[docs/system-architecture-review-2026-07-01-alternatives.md](./docs/system-architecture-review-2026-07-01-alternatives.md)
§2.1. The engine seam (`HostBridge` / `JSRuntime`) is kept clean so the
decision stays reversible.

## How it works

```
┌─ watchOS app (standalone SwiftUI) ──────────────────────────────┐
│                                                                  │
│  QuickJS (quickjs-ng, vendored C, compiled into the target)      │
│   ├── bundle.js = React 19 + react-reconciler + your JSX app     │
│   │   (esbuild single-file IIFE, shipped as an app resource)     │
│   ├── JS → Swift:  __host.commit(treeJSON) on every React commit │
│   │                __host.log / __host.setTimer                  │
│   └── Swift → JS:  __dispatchEvent(nodeId, event, payloadJSON)   │
│                    __fireTimer(id), pending-job drain            │
│                                                                  │
│  NodeView.swift: decodes {id, type, props, children} and renders │
│  real SwiftUI views; taps/toggles dispatch events back to React  │
└──────────────────────────────────────────────────────────────────┘
```

The custom renderer (`js/src/renderer.ts`, a `react-reconciler@0.33` host
config) serializes the full instance tree on every commit — watch screens
are tens of nodes, so diffing isn't worth a protocol. Function props cross
the bridge as `true` flags; node ids are stable, so native events target
live instances. Same producer/consumer pattern as
[react-ssd1306](https://github.com/doodlewind/react-ssd1306),
[react-tvml](https://github.com/sergioramos/react-tvml), and Raycast
(reviewed in [docs/research.md](./docs/research.md)).

## Quick start

In your own Expo app (the plugin does the Xcode wiring — no hand-written
target config):

```bash
npx expo install react-watchos @bacons/apple-targets
# app.json → "plugins": [["react-watchos", { "name": "My Watch", "widget": true }]]
npx react-watchos scaffold     # the @main Swift glue
npx expo prebuild              # creates + links the watch/widget targets
```

In this repo (Linux/macOS, no Xcode needed for the JS half):

```bash
pnpm install
pnpm --filter react-watchos test    # full suite, incl. a real qjs smoke run
pnpm --filter react-watchos dev     # live reload on 127.0.0.1:8788
```

The full path — workspace commands, the consumer tsconfig contract, host
policy, the macOS/Xcode build and its first-build friction — is
[docs/getting-started.md](./docs/getting-started.md). How to *write* screens
(update mechanisms, theming, navigation + deep links, complications and
controls) is [docs/ui-guide.md](./docs/ui-guide.md).

## What's bound today

Beyond the 41 view primitives: `Storage` (App Group UserDefaults), `fetch`
(WHATWG subset over native URLSession), five sensor push streams (heart rate,
motion, gyroscope, location, pedometer), **HealthKit reads**, **real workout
control**, **WorkoutKit plans**, calendar + reminder reads (EventKit), a BLE
central, the full WatchConnectivity surface (messages, application context,
user info, file transfer + an inbound file inbox, session state), local
notifications, remote push to the watch's own APNs token, haptics, audio,
speech, Keychain, device + accessibility info, Always-On
(`onLuminanceReduced`), background refresh, extended-runtime sessions,
StoreKit 2 in-app purchase, widget timelines, and control intents — all
through the same registered-message host surface.

Two documents, not marketing copy, tell you what that means:

- **[docs/status.md](./docs/status.md)** — every capability with its evidence
  level: ① Linux-tested → ② watch-compiled → ③ simulator/device-verified.
  Several health and connectivity features are honestly ③-owed.
- **[docs/api/capabilities.md](./docs/api/capabilities.md)** — the
  component and host-method tables, generated from the same schema the code
  is generated from, so they can't drift.

## Debugging

The question every dev asks in the first hour — *what does a crash on a watch
look like, and how do I read it?* — has a full answer in
**[docs/debugging.md](./docs/debugging.md)**. The short version:

- **Red text filling the screen** = the bundle never booted. **A red bar at
  the bottom** = it booted, then something failed (tap to dismiss).
- Every host-side failure is a structured `Diagnostic` — stable `code`,
  severity, subsystem, `sessionId`, `releaseId` — kept in an always-on ring
  of 50 (release builds too) and readable from JS via `onDiagnostic`.
  `js.eval` / `js.call` / `js.job` / `js.promiseRejection` tell you *where*
  the engine was.
- `<ErrorBoundary onError={captureError}>` gives you React's `componentStack`
  on-device.
- `console.log` and cold-start timings stream to Console.app under subsystem
  `com.reactwatchos.runtime` (categories `js` and `boot`).
- `npx react-watchos inspector` + `startInspector({ url })` streams the live
  committed tree, logs and errors to a browser page on your Mac.
- Most failures reproduce on your laptop: the vitest suite runs the real
  bundle in a real `qjs`, and `tools/embed-smoke/run.sh` runs it through the
  exact embedding sequence Swift uses.

**No React DevTools** — the backend needs a WebSocket transport QuickJS
doesn't have and watchOS can't lend it (no public JavaScriptCore, no WebKit).
No breakpoints, no source maps yet. That gap is real and
[stated in full](./docs/debugging.md#what-this-is-not).

## Battery & power defaults

The renderer is pull/event-driven — it commits only when something re-enters
JS, so it costs nothing while idle — and every default that could keep a radio
or sensor hot is bounded or opt-in: background heart-rate teardown, coalesced
workout metrics, a single shared `HKWorkoutSession`, bounded BLE reconnect,
ten-meter location accuracy, 10 Hz motion, timer leeway, coalesced widget
reloads, and a 1 MB soft cap on file transfers.

The full list with the reason behind each default is
[docs/battery-defaults.md](./docs/battery-defaults.md); how to *measure* any
of it (Instruments, `os_signpost`, the embed-smoke gates, and what we can and
can't claim) is
[docs/performance-measurement.md](./docs/performance-measurement.md).

## Limitations (honest list)

- **Not RN core.** No RN components, no RN ecosystem libraries, no Yoga
  flexbox. 41 SwiftUI-like primitives, each accepting shared layout-modifier
  props (`padding`, `frame`, `background`, `cornerRadius`, `opacity`, `tint`,
  per-node `animation`, stack `alignment`).
- **Controls require watchOS 26**; gated with `#available`, everything else
  runs on watchOS 10+.
- **No `Intl`.** QuickJS ships without the ECMAScript i18n API, so
  `toLocaleString` and friends render a hardcoded US-style format. The answer
  is to hand native the declarative target — `<FormattedText>` for dates and
  numbers, plus a JS-resolved translation layer with a CLDR plural seam. Full
  rationale: [docs/ui-guide.md](./docs/ui-guide.md#text-formatting--translation-there-is-no-intl).
- **Input round-trips.** Toggle/Picker/TextField hold optimistic local state
  released by a seq-ack protocol, so rapid interactions can't snap back to
  stale values — the mechanism is
  [documented](./docs/ui-guide.md#input-round-trips-optimistic-state), and it
  is a mechanism, not magic.
- **Hardware verification is partial.** The stack boots and renders on a
  physical Apple Watch Ultra 3 (2026-07-05, properly signed against a real
  team). **Not yet verified on hardware:** Taptic haptics, Digital Crown feel,
  the HealthKit and GPS streams, a complication on a live watch face, BLE
  against a real peripheral. WatchConnectivity file transfer is
  *unverifiable* on a simulator by Apple's own documentation — it needs two
  paired devices.
- **Interpreter speed** (no JIT — Apple forbids it for everyone). Fine for
  UI-sized work; don't mine bitcoin in `useEffect`.
- **Full-tree commits**: ideal for watch-sized screens; large lists would want
  the diffing optimization noted in [docs/research.md](./docs/research.md).
- **Bundle size**: demo app ~565 KB unminified / ~179 KB minified against a
  200 KB CI budget (widget bundle 145 KB against 160 KB); QuickJS itself adds
  ~1 MB of code — comfortably inside the watch app budget. Point-in-time
  numbers (2026-07-04); the enforced truth is the budget check, and every
  limit is tabulated in
  [docs/budgets-and-limits.md](./docs/budgets-and-limits.md).
- **CI has never run.** GitHub Actions is disabled at the repo level, so the
  Linux and macOS workflows have never executed — the gates are run locally.
  Recorded in [docs/status.md](./docs/status.md).

## When NOT to use this

Limitations are things you work around; these are reasons to pick something
else. Five, honestly:

- **You need custom native views.** The op channel has a documented escape
  hatch (`getHost()` — install and call your own native op). **Views have
  none.** `NodeView.swift` renders the tree with a closed `switch` whose
  `default:` arm skips the node, so the set of renderable node types is fixed
  in the Swift you built from — an app cannot register a new one, and neither
  can an OTA bundle. That is deliberate (the same node type must mean the same
  thing in the app, the widget extension and the codegen schema), but if your
  design needs a bespoke SwiftUI view *inside* the React tree, this renderer
  is the wrong layer for that part of your UI. The workarounds — compose
  `ReactWatchRootView` inside your own SwiftUI, or contribute the primitive —
  are in [docs/extending.md](./docs/extending.md#the-hatch-is-for-ops-not-views).
- **Your app is a pure sensor pipeline and every milliwatt counts.** If the
  product is mostly background data collection with a thin UI, the JS layer
  buys you little and costs a bridge crossing per reading. Native Swift is the
  better trade. This renderer earns its keep where there is real UI and real
  state to manage.
- **Your team is already fluent in SwiftUI and doesn't want JSX.** SwiftUI on
  watchOS is genuinely good. The reason to reach for this is a React codebase,
  React ergonomics, or the OTA update path — not because SwiftUI is hard. If
  none of those apply, you are adding an engine for nothing.
- **You want one JS codebase for iPhone *and* watch today.** You will not get
  it here. React Native runs the phone; this runs the watch; they share no
  component vocabulary, no layout model, and no ecosystem libraries. Sharing
  is realistic for your *logic* (plain TypeScript, compiled into both
  bundles), not your UI — the watch screens get written separately, and
  budgeting for that up front is the honest plan.
- **Your tolerance for App-Review risk is zero and you need OTA.** Signed OTA
  is the differentiator, and it has **not been through App Review yet**. The
  carve-out that makes CodePush/expo-updates routine on iOS is written around
  WebKit and JavaScriptCore — neither of which exists on watchOS — so our
  reading of the rules ([docs/ota-signing.md](./docs/ota-signing.md) maps the
  design to DPLA §3.3.1(B) and Guideline 2.5.2) is a *reading*, not a
  precedent. The renderer works fine with OTA switched off, so this is a
  reason to defer the update pipe rather than the whole library — but if a
  rejection would be expensive for you, wait for the receipt.

## Versioning & stability

- **Pre-1.0 (`0.x`): every release may break.** Nothing has shipped to a
  store yet and the project deliberately prefers clean breaking changes over
  compatibility shims — pin an **exact** version (`"react-watchos": "0.1.0"`,
  no `^`/`~`) and read the changelog before upgrading.
- **OTA bundles are coupled to the native binary** — the fact that bites
  adopters: a served bundle must match the binary's wire version (`tree.v`),
  bridge protocol / capability features (ARCH-01), and signing scheme
  (currently `v2`). Upgrading `react-watchos` in your app and shipping a new
  binary **strands previously published OTA bundles**: an old-wire bundle is
  refused at commit time (the wire-version reject feeds the crash-loop
  counter, so devices self-heal to the shipped bundle rather than brick —
  but they silently stop taking that OTA). **Ship a rebuilt + re-signed OTA
  bundle together with every app-binary release that upgrades this library.**
- **Signature scheme changes require re-signing.** `v1 → v2` (signed expiry)
  already happened pre-release; when the scheme changes, every served
  manifest/bundle must be re-signed or the fleet refuses it.
- **Post-1.0 intent:** semver, where a change to the wire version, the bridge
  protocol, or the signing scheme is by definition a **major**.

## Docs

| Doc | What |
|---|---|
| [docs/README.md](./docs/README.md) | **Docs index + the current backlog** — start here for reviews and architecture decisions. |
| [docs/status.md](./docs/status.md) | Verified current capabilities — the "is it real?" matrix. Supersedes "shipped" claims elsewhere. |
| [docs/getting-started.md](./docs/getting-started.md) | Running, consuming, the Expo plugin, the macOS/Xcode path, repo layout. |
| [docs/ui-guide.md](./docs/ui-guide.md) | Writing screens: update mechanisms, theming, navigation, widgets/controls, formatting. |
| [docs/debugging.md](./docs/debugging.md) | What a crash on-wrist looks like and how to read it. |
| [docs/battery-defaults.md](./docs/battery-defaults.md) | Every power-related default and why. |
| [docs/api/](./docs/api/README.md) | Generated API reference (typedoc) + the generated capability tables. |
| [docs/ota-signing.md](./docs/ota-signing.md) | The update channel: keys, rotation, threat model, DPLA §3.3.1(B). |
| [docs/extending.md](./docs/extending.md) | Adding a native capability — and where the escape hatch stops. |
| [docs/research.md](./docs/research.md) | Why RN-core-on-watchOS is impossible; engine and architecture comparison. |
| [docs/prior-art.md](./docs/prior-art.md) | Where this sits among production React renderers (RN, Raycast, r3f, Ink…). |
| [docs/roadmap.md](./docs/roadmap.md) | Forward plan in three tracks, with the Mac-build gate. |
| [docs/engineering-notes.md](./docs/engineering-notes.md) | The non-obvious learnings (React-in-QuickJS, bytecode, threading, the compiler). |
