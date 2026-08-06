# react-watchos — repo rules for AI assistants

**Before changing code here, read [`CONTRIBUTING.md`](./CONTRIBUTING.md) and
[`docs/README.md`](./docs/README.md)** (the latter is the front door to the
current improvement plan / backlog).

**Commits:** Conventional Commits with a **mandatory area scope** — pick the area the
change actually lives in: `js` (renderer/runtime TS in js/src), `swift`
(host/runtime/support), `widget` (WidgetKit side), `plugin` (Expo config
plugin + scaffold + bin), `build` (esbuild preset, bundling, packaging),
`demo`, `examples`, `app` (reference app targets), `docs`, `ci`, `deps`,
or `repo` for cross-cutting changes — e.g. `fix(swift): …`,
`feat(widget): …`. (History note: the first 700+ commits carry the
monorepo-era scope `react-native-watchos`; that scope is retired — don't
use it for new commits.)
Imperative mood, lowercase subject, ≤72-char header; AI-assisted commits add
a `Co-Authored-By:` trailer.
**Merging:** always a real merge commit — never squash, never rebase-merge.

Three project rules that bite if you miss them:

1. **Pre-release — break freely.** Nothing has shipped/been built/signed. Prefer
   the clean target shape over compatibility: no scheme-version bumps for
   unsigned formats, no "tolerates old payload" branches, no deprecation shims.
   Change the format/API/struct and update all call sites + tests together. Keep
   structures extensible only where a known future axis is coming.

2. **Verify Apple platform availability before calling a feature unavailable.**
   Fetch the docs JSON
   (`https://developer.apple.com/tutorials/data/documentation/<framework>.json`),
   read `platforms`/`introducedAt`/`beta`. `#if canImport(...)` is a compile-time
   SDK check — "always rejects" can just mean the build SDK was too old.
   (FoundationModels **is** on watchOS 27.0+ beta; the bug was the `watchOS 26.0`
   gate.)

3. **Research prior art / SOTA before designing a NEW subsystem, not after.**
   "Read before you write" covers *our* code; this
   covers the *outside world*. Before hand-rolling a whole layer (i18n,
   theming, a parser, a scheduler…), first survey how the best-in-class
   libraries solve it — their API shape, their edge cases, their measured cost
   — and only then decide: adopt, borrow-the-good-parts, or hand-roll with a
   documented reason. When you do hand-roll, **prefer a published type package
   over a hand-written shim** (`@types/<pkg>` if it exists), and record *why*
   the library wasn't taken (constraint or size), so the choice reads as a
   decision. (Lesson from the i18n layer: it was designed first-principles, and
   a later prior-art pass found `plurals-cldr` — a ~2.7 KB, zero-`Intl` CLDR
   plural engine — that our hand-rolled English-only default silently got
   wrong for Arabic/Slavic.)

The full plan + decision log is in `docs/` — later dated reviews supersede
earlier ones; the merged backlog is the reconciled view.

**Naming:** the npm package publishes as **`react-watchos`** (B2: the
`react-native-watchos` npm name is squatted, and the `react-native-*` prefix
implied an RN-core membership the docs disclaim). The project FOLDER and the
commit scope stay `react-native-watchos` — folder renames churn every path;
only the published identity changed. Dated review docs keep the old name as
historical record.
