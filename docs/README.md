# react-native-watchos — docs index

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
  SD-2 (refined by ARCH-10: core + adapters).
- [design-typed-bridge-codegen-2026-06-25-1855.md](./design-typed-bridge-codegen-2026-06-25-1855.md) —
  SD-1/SD-6 (refined by ARCH-11: generated typed envelopes).
- [design-arch-02-capability-contract.md](./design-arch-02-capability-contract.md) —
  ARCH-02 explicit capability contract. Criterion #4 (no raw `__host` in app
  code) **done + CI-guarded**; flags the side-effect soundness hole that the
  declared-contract/marker design (criteria #1–3, 5) must handle.
- [design-ble-result-reporting.md](./design-ble-result-reporting.md) —
  CX-022 BLE connect/write result reporting. Spec ready; **device-gated** (no
  simulator Bluetooth radio), so deliberately not shipped blind.
- [design-cx-025-release-freshness.md](./design-cx-025-release-freshness.md) —
  CX-025 OTA `releaseId` (so non-breaking fixes can ship). Core primitive proven
  (JS FNV-1a == Swift `ContentHash`); spec ready for a focused load-flow pass.
- [design-bundler-choice.md](./design-bundler-choice.md) — why the watch bundle
  uses esbuild (not Metro/Vite/Rollup/Bun), and when to revisit Rolldown.
  Verified against the 2026 landscape.
- [design-arch-08-runtime-session.md](./design-arch-08-runtime-session.md) —
  ARCH-08 RuntimeSession isolation: the per-runtime vs persistent-transport
  seam, why it's deferred (no failing scenario today), and the shape to build.

- [code-review-2026-06-27-deep-dive.md](./code-review-2026-06-27-deep-dive.md) — adversarially-verified code+design+DX review (64 confirmed findings; the blocker is fixed).
- [code-review-2026-07-02-self-review-cycles.md](./code-review-2026-07-02-self-review-cycles.md) — three adversarial self-review cycles over the session's blind-written Swift/JS (capability, render-pipeline, core); 20 confirmed+fixed so far incl. a critical Swift-6 compile break.
- [system-architecture-review-2026-07-01-alternatives.md](./system-architecture-review-2026-07-01-alternatives.md) —
  full-system review + strategic alternatives (NF-01…36): engine
  (quickjs-ng vs XS/Moddable vs Hermes, argued in depth), UI model (React
  vs SolidJS/signals — verdict: the wire protocol is the real seam),
  design-system layer spec, and a prioritized P0–P2 plan. Newest review;
  supersedes earlier ones where they disagree.

## Reference / background

- [launch-checklist.md](./launch-checklist.md) — pre-marketing gates with
  honest statuses (engineering, release, security posture, claims discipline).
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
