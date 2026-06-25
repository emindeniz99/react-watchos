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

## Reference / background

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
