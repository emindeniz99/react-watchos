# Contributing / working conventions — react-native-watchos

Conventions specific to this project, for humans and AI agents picking up the
work. (Agent-facing rules live in [`CLAUDE.md`](./CLAUDE.md); this file is the
project layer for everyone.)

**Commits:** Conventional Commits with the mandatory scope
`react-native-watchos` — `feat(react-native-watchos): …`, imperative mood,
lowercase subject, ≤72-char header; AI-assisted commits add a
`Co-Authored-By:` trailer. **Merging:** always a real merge commit — never
squash, never rebase-merge; per-commit history is the record of how this was
built.

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

- **All JS gates need the mise-pinned Node 24** (`.mise.toml`): vitest
  `require()`s typed `.cts` tooling through Node's native type stripping.
  If `pnpm` resolves from another Node installation — the classic is an nvm
  dir ahead of mise on PATH; its corepack shim then runs under *that* Node,
  and `mise exec -- pnpm …` does **not** help because mise only resolves the
  first command — exactly two files (`plugin.test.ts`, `scaffold.test.ts`)
  used to die with a cryptic `SyntaxError: Unexpected token`. The suite now
  refuses to start with instructions instead (see `js/vitest.config.ts`).
  Quick fix: `PATH="$(mise where node)/bin:$PATH" pnpm test`, or activate
  mise in the shell. The same trap has a second home: `expo prebuild`
  hardcodes the node it saw into `app/ios/.xcode.env.local`, and Xcode
  script phases use *that* binary regardless of your shell — `run:watch`
  now verifies the floor and re-pins that file on every run.
- **JS + pure Swift logic — works anywhere (incl. Linux/CI):**
  `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `swift test` (the host is
  `#if os(watchOS)`-guarded so the package builds and tests on macOS/Linux
  without the watch UI).
  **Run `pnpm test` / `pnpm typecheck` from the workspace ROOT, not from
  `js/`** — the root scripts are `pnpm --recursive`, so they cover
  `examples/*` too; from `js/` they cover only the renderer. That gap is not
  theoretical: the expo example's test asserted `dispatchEvent(...) === true`
  and stayed red from ARCH-09 (2026-07-16) until 2026-07-28, because every
  local loop ran the renderer's gates from `js/` while only CI ran the
  examples.
- **The Darwin bridges (`BluetoothBridge` et al.) — macOS, on the watch sim:**
  `pnpm test:swift:watch` runs the Swift suite via `xcodebuild test` on a
  watchOS simulator, where the `#if os(watchOS)` code actually compiles, so the
  bridge tests (e.g. `BluetoothBridgeTests`) exercise it. `swift test` can't —
  those bridges are empty modules off-watchOS. Add a Darwin-only bridge test as
  `#if os(watchOS)` with `@testable import ReactWatchHost`.
- **The watch UI, widget, target wiring, WidgetKit, navigation timing, and
  extension memory are the macOS/Xcode + on-device gate** — not covered by the
  above. GitHub Actions are intentionally not relied on for the native build;
  verify those locally (see the build/run notes in the renderer README and
  `docs/`).
- **Running the full demo app on the watch sim (level ③):** `cd js && pnpm
  run:watch`. **Read [`docs/running-on-sim.md`](./docs/running-on-sim.md)
  first** — the App Group that backs Hydration/Shopping/widgets gets stripped
  three different sim-specific ways, and shared-state screens silently read `0`
  if you hand-roll `xcodebuild` instead of using the script. This wasted real
  time before it was written down.

### macOS build gotchas (these waste hours if you don't know them)

- **Compile the package for the watch SDK (fast, no pods):**
  `cd js/swift && xcodebuild build -scheme ReactWatchHost-Package -sdk
  watchsimulator<ver> -destination 'generic/platform=watchOS Simulator'`. This
  compiles `ReactWatchHost` **and** `ReactWatchWidget` against the real
  WidgetKit/SwiftUI SDK — the best gate for host/widget changes. `swift build`
  alone does **not** (those targets are `#if os(watchOS)`, empty off-watchOS).
- **`pod install` crashing with `Unicode Normalization not appropriate for
  ASCII-8BIT`** is a Ruby 4.x + CocoaPods 1.16 bug, not your change. Prefix the
  command with `RUBYOPT="-EUTF-8"` (e.g. `cd app/ios && RUBYOPT=-EUTF-8
  pod install`). `expo prebuild` runs `pod install` internally, so set it there
  too if prebuild dies at the pods step.
- **The widget extension can't be built standalone** — the "React Watch Widgets"
  scheme only offers iOS destinations at build time (the `.appex` is embedded in
  the watch app embedded in the iOS app, so it drags in the hermes/RN pod graph,
  which fails for watchOS with `undefined_arch`). To check that the demo's (or a
  consumer's) widget Swift compiles against the package **without** the full app
  build: build the package for watch (above) to a `-derivedDataPath`, then
  `xcrun --sdk watchsimulator<ver> swiftc -typecheck -parse-as-library -target
  arm64-apple-watchos10.0-simulator -sdk <sdk> -I <dd>/Build/Products/Debug-watchsimulator
  -Xcc -fmodule-map-file=js/swift/Sources/CQuickJS/include/module.modulemap
  -Xcc -Ijs/swift/Sources/CQuickJS/include <files>.swift`. `-parse-as-library`
  is required (else `@main` errors); the `-Xcc` CQuickJS path is required (else
  "missing module CQuickJS", pulled in transitively via `ReactWatchRuntime`).

## Commits

Follow the monorepo convention (Conventional Commits, **mandatory scope**). The
scope for this project is the leaf name **`react-native-watchos`** (optionally
`react-native-watchos/<sub-area>`), per the root `CLAUDE.md`. Add the
`Co-Authored-By:` trailer for the AI assistant that made the commit. Default to a
real merge commit for PRs (never squash without an explicit ask).
