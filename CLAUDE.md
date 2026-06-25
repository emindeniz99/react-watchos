# react-native-watchos — project rules for AI assistants

Repo-wide rules are in the monorepo root `CLAUDE.md`. This is the project layer.
**Before changing code here, read [`CONTRIBUTING.md`](./CONTRIBUTING.md) and
[`docs/README.md`](./docs/README.md)** (the latter is the front door to the
current improvement plan / backlog).

Two project rules that bite if you miss them:

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

Commit scope is **`react-native-watchos`** (Conventional Commits, scope
mandatory, `Co-Authored-By:` trailer). The full plan + decision log is in
`docs/` — later dated reviews supersede earlier ones; the merged backlog is the
reconciled view.
