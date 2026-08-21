# react-watchos — docs index

**Start here for the current improvement plan →
[code-review-2026-06-25-1817-merged.md](./code-review-2026-06-25-1817-merged.md)**

That file is the single, ranked, verified, decision-baked backlog to work from:
architecture decisions first (SD-1…SD-6 + Codex ARCH-01…14), then Phases 0–5 of
the per-item fixes. Every item carries `file:line` evidence, the decided fix, and
an effort estimate. Everything else here feeds into it.

**"Is feature X actually real yet?" →
[status.md](./status.md)** — the single, evidence-backed view of verified
current state (a maturity-tiered capability matrix, each claim linked to a
test/build). Distinct from the backlog (what to *work on*) and roadmap (what's
*planned*). When a doc says "shipped", status.md is the authority.

**Conventions for working here:** [`../CONTRIBUTING.md`](../CONTRIBUTING.md) —
pre-release "break freely", verify-Apple-availability-before-assuming, the
JS-driven principle, and how to verify changes. (Agents also auto-load
[`../CLAUDE.md`](../CLAUDE.md).)

## How to pick this up cold

1. Read the merged backlog top-to-bottom.
2. Do the **architecture decisions first** — the agreed first move is
   **ARCH-01 + ARCH-03 + ARCH-04 together** (feature model + per-target
   app/widget artifacts + transactional OTA). Building the older scalar
   `hostApiVersion` design first would be thrown away.
   *(2026-07-16: that foundation trio — and ARCH-05/09/12/13 — shipped long
   since; see the backlog's build-progress log. Pick up from its unticked
   rows.)*
3. Then work Phases 0–5.
4. **When two reviews disagree, the later one wins** and the merged backlog says
   so (e.g. Codex's feature-set supersedes the scalar gate; the design notes
   carry "superseded" banners where relevant).

## The plan (work from this)

- **[code-review-2026-06-25-1817-merged.md](./code-review-2026-06-25-1817-merged.md)** —
  THE backlog. Architecture decisions + Phases 0–5 + verdicts/evidence/effort +
  what's intentionally skipped (CX-013) and done (CX-028).

## Source reviews (detail behind the plan)

- [code-review-2026-06-25.md](./code-review-2026-06-25.md) — original CR-1…CR-17
  backlog (delivered, green).
- [code-review-2026-06-25-1735-codex.md](./code-review-2026-06-25-1735-codex.md) —
  Codex defect review (CX-001…CX-028).
- [code-review-2026-06-25-opus.md](./code-review-2026-06-25-opus.md) — Opus defect
  review + reconciliation (OP-1…OP-6).
- [system-design-review-2026-06-25-1824-opus.md](./system-design-review-2026-06-25-1824-opus.md) —
  Opus architecture review (SD-1…SD-6).
- [system-architecture-review-2026-06-25-1859-codex.md](./system-architecture-review-2026-06-25-1859-codex.md) —
  Codex architecture review (ARCH-01…ARCH-14).
- [dx-integration-review-2026-06-25-1859.md](./dx-integration-review-2026-06-25-1859.md) —
  DX / config-plugin / connectivity review (DX-1…DX-7).

## Design notes (pre-code; decisions resolved)

- [design-ota-capability-gate-2026-06-25-1847.md](./design-ota-capability-gate-2026-06-25-1847.md) —
  SD-3/SD-4 capability gate + OTA state machine. *Partly superseded by Codex
  ARCH-01/02/05 — see the banner at the top.*
- [design-shared-interpreter-2026-06-25-1855.md](./design-shared-interpreter-2026-06-25-1855.md) —
  SD-2 (refined by ARCH-10: core + adapters). **Phase A shipped** (`RNUI` shared
  target — the drift is gone); **Phase B declined at two targets** with a
  documented revive trigger — see the ARCH-10 note in the codex review.
- [design-typed-bridge-codegen-2026-06-25-1855.md](./design-typed-bridge-codegen-2026-06-25-1855.md) —
  SD-1/SD-6 (refined by ARCH-11, shipped re-scoped 2026-07-27: schema-declared
  invoke request/result shapes with cross-language fixtures and a
  runtime-closed error enum — *not* generated envelopes; `deadline`/`sessionId`/
  cancellation/backpressure are recorded as WONTFIX on the review heading).
- [design-arch-02-capability-contract.md](./design-arch-02-capability-contract.md) —
  ARCH-02 explicit capability contract. Criterion #4 (no raw `__host` in app
  code) **done + CI-guarded**; flags the side-effect soundness hole that the
  declared-contract/marker design (criteria #1–3, 5) must handle.
- [design-ble-result-reporting.md](./design-ble-result-reporting.md) —
  CX-022 BLE connect/write result reporting. **Implemented in code** per the
  spec (`bleConnect`/`bleWrite`/`bleSubscribe` settle as promises over invoke;
  `BleSession` correlation Linux-tested); the remaining slice is **device
  verification** (no simulator Bluetooth radio).
- [design-health-package.md](./design-health-package.md) — the HEALTH package
  (HealthKit reads, real workout control, CMPedometer), shipped 2026-07-29.
  Records the single-`HKWorkoutSession`-owner unification (the structural
  decision), the `health`/`workouts` feature split, the availability sweep (all
  84 `HKWorkoutActivityType` cases; nothing above the watchOS 10 floor, so not
  one `@available` gate), and the four named follow-ups. Also records why
  health is **device-only ③**: the sim run script signs without the `healthkit`
  entitlement on purpose.
- [design-workout-plans.md](./design-workout-plans.md) — the WORKOUT-PLANS
  package (WorkoutKit: compose a structured workout, hand it to Apple's Workout
  app, schedule it), shipped 2026-07-29 as the `workoutPlans` follow-up the
  health package recorded. Records the 124-page availability sweep (the package
  is `@available`-free, and the four symbols above the watchOS 10 floor are cut
  for exactly that reason), the new `workoutPlans` feature + the camelCase
  convention break it takes deliberately, the naming hazard around Apple's own
  `WorkoutPlan` type, and — the design's spine — that
  `WorkoutScheduler`'s mutators are **non-throwing and return nothing**, so
  every mutation is verified by READ-BACK. Also records the standing
  uncertainty plainly: `openInWorkoutApp()` is watch-native beyond doubt,
  while **watch-side scheduling is ③ device-unverified** (Apple's own sample
  schedules from iPhone), with a 7-step sim spike as the next Mac-session step.
- [design-platform-data-package.md](./design-platform-data-package.md) — the
  PLATFORM-DATA package (WatchConnectivity file transfer + session state,
  EventKit reads, Always-On `isLuminanceReduced`), shipped 2026-07-29. Records
  the availability sweep (nothing in it needs an `@available` gate — the
  highest floor is `requestFullAccessToEvents` at exactly watchOS 10.0), why
  `transferFile` does NOT park its invoke, why the transfer-id space is the
  deliberate opposite of the BLE reset hook, why the inbound file move has to
  precede the main-queue hop, the `calendar` single-feature decision, and the
  two Always-On initial-value mechanisms that both have to exist. Also records
  the standing gaps: file transfer is 🔴 **unverifiable on a simulator** (Apple
  says so twice) and wrist-down is device-only.
- [design-cx-025-release-freshness.md](./design-cx-025-release-freshness.md) —
  CX-025 OTA `releaseId` (so non-breaking fixes can ship). Core primitive proven
  (JS FNV-1a == Swift `ContentHash`); spec ready for a focused load-flow pass.
- [design-bundler-choice.md](./design-bundler-choice.md) — why the watch bundle
  uses esbuild (not Metro/Vite/Rollup/Bun), and when to revisit Rolldown.
  Verified against the 2026 landscape.
- [design-dap-debugger.md](./design-dap-debugger.md) — real breakpoints for
  watch JS without JavaScriptCore. Records the finding that quickjs-ng has **no
  debug hooks to drive** (only a positionless interrupt watchdog), so the
  breakpoint moves into a DEBUG-only source transform; and the second finding
  that `fetch` cannot be the paused transport (it settles by hopping onto the
  queue a paused debugger is holding), so one synchronous `#if DEBUG` host hook
  is needed. Prototype landed and gated end-to-end in the vendored engine;
  measured at +5.2 % bytes / +1.1 % per interaction; the watchOS wiring is
  flagged as not yet run on hardware.
- [design-arch-08-runtime-session.md](./design-arch-08-runtime-session.md) —
  ARCH-08 RuntimeSession isolation: the per-runtime vs persistent-transport
  seam, why it's deferred (no failing scenario today), and the shape to build.
  **Superseded in scope (2026-07-27):** ARCH-08 shipped as
  `WatchRoot.dispose()` + a queue-confined `JSRuntime.shutdown()`, no session
  type; the doc's "no failing scenario" claim is refuted by two of the three
  findings. Kept as the record of the other reading — see the annotation at
  its head and the re-scoped heading in the codex architecture review.

- [code-review-2026-06-27-deep-dive.md](./code-review-2026-06-27-deep-dive.md) — adversarially-verified code+design+DX review (64 confirmed findings; the blocker is fixed).
- [code-review-2026-07-02-self-review-cycles.md](./code-review-2026-07-02-self-review-cycles.md) — three adversarial self-review cycles over the session's blind-written Swift/JS (capability, render-pipeline, core); 20 confirmed+fixed so far incl. a critical Swift-6 compile break.
- [system-architecture-review-2026-07-01-alternatives.md](./system-architecture-review-2026-07-01-alternatives.md) —
  full-system review + strategic alternatives (NF-01…36): engine
  (quickjs-ng vs XS/Moddable vs Hermes, argued in depth), UI model (React
  vs SolidJS/signals — verdict: the wire protocol is the real seam),
  design-system layer spec, and a prioritized P0–P2 plan.
- [full-project-review-2026-07-04.md](./full-project-review-2026-07-04.md) —
  **the production-readiness review** (all 8 dimensions, adversarially
  verified): 4 blockers (dark CI pipeline, npm name taken, widget-runtime
  deadlock, Swift-6 compile breakers), 19 confirmed majors, per-dimension
  scorecard, ordered action plan, and roadmap. Newest *full-scope* review;
  supersedes earlier ones where they disagree. Its §0 reconciliation table
  tracks resolution (updated through 2026-07-16).
- [perf-battery-audit-2026-07-08.md](./perf-battery-audit-2026-07-08.md) —
  full app+widget **performance/battery audit** (3 P0s, 12 P1s, a P2 batch) and
  the authoritative record of the fix passes that followed: bounded BLE
  reconnect, background HR teardown, timer leeway, widget staleness gate +
  reload debounce, `@Observable` migration, formatter/image caches, os.Logger
  console, the quickjs stack-guard fix — plus the package's **first-ever Swift
  compile + `swift test`, on Linux**.

## Using it (the README's deep content lives here)

The project README was restructured on 2026-07-29 into a front door; the deep
material moved here **unchanged in substance**, each page focused on one job:

- [getting-started.md](./getting-started.md) — repo layout, workspace commands,
  consuming the package (Expo plugin + scaffold), host policy, the consumer
  tsconfig contract, the macOS/Xcode build and its first-build friction.
- [ui-guide.md](./ui-guide.md) — writing screens: instant/periodic/smooth
  update mechanisms, theming, navigation + deep links, React-authored
  complications/widgets/controls, formatting without `Intl`, optimistic input.
- [battery-defaults.md](./battery-defaults.md) — every power-related default
  and the reason behind it (policy, not benchmarks).
- [engineering-notes.md](./engineering-notes.md) — the non-obvious learnings
  (React-in-QuickJS, bytecode, threading, the React Compiler).

## Reference / background

- [api/](./api/README.md) — **generated API reference** (M12): every export +
  type via typedoc (`pnpm docs:api`), plus [capabilities.md](./api/capabilities.md)
  — the component/host-method tables emitted from `codegen/schema.mjs` so they
  can't drift from the tested contract. Regenerate after any public-surface
  change; the output is committed.
- [launch-checklist.md](./launch-checklist.md) — pre-marketing gates with
  honest statuses (engineering, release, security posture, claims discipline).
- [debugging.md](./debugging.md) — what a crash on-wrist looks like and how to
  read it: the full-screen/banner/diagnostics-ring/Console.app/remote-inspector
  surfaces, the `js.*` diagnostic codes, the local `qjs`/embed-smoke repro loop,
  and — stated plainly — what this is NOT (no React DevTools, no breakpoints).
- [performance-measurement.md](./performance-measurement.md) — how to measure
  CPU/memory/render/energy: the `tools/embed-smoke` engine harness (runs on CI),
  `os_signpost`, Instruments on a physical watch, and why MetricKit is
  phone-only. Read before making any perf/battery claim.
- [reconciler-version-matrix.md](./reconciler-version-matrix.md) — ARCH-14:
  the tested react/react-reconciler/@types matrix, the types-vs-runtime drift
  the adapter's single cast bridges (re-measured at `@types` 0.33.0 — the
  cast survives, with the six tsc errors that prove it), and the upgrade
  procedure. Read before bumping React or the reconciler.
- [announcement-draft.md](./announcement-draft.md) — launch copy (short post,
  blog outline, prewritten FAQ) written against the checklist's claims lists;
  bracketed gates must clear before publishing.
- [status.md](./status.md) — verified current capabilities (the "is it real?"
  matrix; superseding "shipped" claims elsewhere).
- [roadmap.md](./roadmap.md), [publishing.md](./publishing.md),
  [extending.md](./extending.md), [ota-signing.md](./ota-signing.md),
  [prior-art.md](./prior-art.md), [research.md](./research.md),
  [consumer-feedback.md](./consumer-feedback.md), [updates.md](./updates.md).
- [expo-widgets-comparison.md](./expo-widgets-comparison.md) — why we're not a
  duplicate of Expo's iOS Widgets SDK, + concrete DX nudges worth borrowing.

> Note: the dated review/design files are a decision log — they are **not**
> rewritten as decisions evolve; later files supersede earlier ones and the
> merged backlog is the reconciled, current view.
