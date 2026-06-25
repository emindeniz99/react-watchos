# Contributing / working conventions — react-native-watchos

Conventions specific to this project, for humans and AI agents picking up the
work. (Repo-wide rules — commit format, the 12 behavioral rules — live in the
monorepo root [`CLAUDE.md`](../../CLAUDE.md); this file is the project layer.)

## Where the plan lives

**[`docs/README.md`](./docs/README.md) is the front door.** It points to the
[merged backlog](./docs/code-review-2026-06-25-1817-merged.md) — the single
ranked, verified, decision-baked list to work from (architecture decisions
first, then Phases 0–5). Start there before touching code.

**Decision-log convention:** the dated `docs/*review*.md` and `docs/design-*.md`
files are a log — they are **not** rewritten as thinking evolves. Later files
supersede earlier ones, and the merged backlog is the reconciled current view.
When two disagree, the later wins and the backlog says so (e.g. the Codex
feature-set model supersedes the earlier scalar capability gate).

## Working principles (these bite — read before changing code)

1. **Pre-release: break freely.** Nothing has shipped, been built into an app,
   published to npm, or had an OTA bundle signed in the wild. There are no
   consumers and no artifacts to stay compatible with. **Prefer the clean target
   shape over a migration path.** Do *not* add: scheme-version bumps for formats
   nobody has signed (keep one format, change it in place), "tolerates old
   payload" / back-compat branches, deprecation shims, or dual codepaths to ease
   a rollout. Change the format/API/struct to what it should be and update all
   call sites + tests together. The one thing to still do: leave structures
   **extensible** where a known future axis is coming (e.g. the OTA release
   record is a struct so a future `dataSchemaVersion` is additive).

2. **Verify Apple platform availability before declaring a feature
   unavailable.** Apple's docs site is a JS SPA — fetch the backing JSON
   (`https://developer.apple.com/tutorials/data/documentation/<framework>.json`)
   and read `platforms`/`introducedAt`/`beta`. Don't inherit a "platform X
   doesn't support Y" claim from a review without checking. Concrete case:
   FoundationModels **is** on watchOS 27.0+ (beta) via `SystemLanguageModel` —
   the bug was the code gating at `watchOS 26.0`, not a missing framework. (Also:
   `#if canImport(FoundationModels)` is a compile-time SDK check, so "always
   rejects" can just mean the build SDK was too old.)

3. **Keep it JS-driven.** App logic, UI, and data live in JS/React; the Swift
   side is a thin binding layer (engine embedding, the SwiftUI interpreter,
   native-capability bridges). The project's reason to exist is the Swift↔JS
   binding — don't push app behavior into Swift that could live in JS.

## Verifying changes

- **JS + pure Swift logic — works anywhere (incl. Linux/CI):**
  `pnpm test` (renderer + examples), `pnpm typecheck`, `pnpm lint`, and
  `swift test` (the host is `#if os(watchOS)`-guarded so the package builds and
  tests on macOS/Linux without the watch UI).
- **The watch UI, widget, target wiring, WidgetKit, navigation timing, and
  extension memory are the macOS/Xcode + on-device gate** — not covered by the
  above. GitHub Actions are intentionally not relied on for the native build;
  verify those locally (see the build/run notes in the renderer README and
  `docs/`).

## Commits

Follow the monorepo convention (Conventional Commits, **mandatory scope**). The
scope for this project is the leaf name **`react-native-watchos`** (optionally
`react-native-watchos/<sub-area>`), per the root `CLAUDE.md`. Add the
`Co-Authored-By:` trailer for the AI assistant that made the commit. Default to a
real merge commit for PRs (never squash without an explicit ask).
