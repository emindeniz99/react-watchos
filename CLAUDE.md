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

1. **Published, pre-1.0 — break cleanly, never silently.** `react-watchos` is
   on npm (0.1.0 through 0.7.0 as of 2026-09-17) with real consumers, so the
   old "nothing has shipped, break freely" rule is gone. Still prefer the
   clean target shape over compatibility shims — no "tolerates old payload"
   branches, no deprecation layers — but every breaking change carries `!` in
   the commit header (release-please turns it into the next 0.x minor) and an
   entry in MIGRATIONS.md saying what a consumer does about it. Signed OTA
   messages are the one wire format with a built-in story: the signature
   covers the scheme prefix (`v2:` today), so a binary that verifies a newer
   scheme rejects an old-scheme bundle as unsigned and keeps its shipped
   bundle — no compatibility branch needed (see docs/ota-signing.md).

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
implied an RN-core membership the docs disclaim). Only the published
identity changed; the commit scope is the area list above (the old
`react-native-watchos` scope is retired, see the history note there). Dated review docs keep the old name as
historical record.
