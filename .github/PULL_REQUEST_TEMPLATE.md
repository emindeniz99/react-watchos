<!-- Thanks! Two ground rules from CONTRIBUTING.md:
     - Conventional Commits with a mandatory AREA scope: type(area): subject
       where area is one of js, swift, widget, plugin, build, demo, examples,
       app, docs, ci, deps, repo (see CONTRIBUTING.md)
     - This repo merges with real merge commits (no squash), so clean per-commit history matters. -->

## What & why

<!-- The problem being solved, not just the diff. -->

## Verification

<!-- Which gates ran: `pnpm test` / `pnpm typecheck` / `pnpm lint` (Node 24 — see CONTRIBUTING),
     `swift test`, and for native changes `pnpm test:swift:watch` (watch sim).
     If something is device-only (③ in docs/status.md), say what's verified and what isn't. -->

## Docs

<!-- If this changes the public surface: `pnpm docs:api` regenerated? status.md/roadmap.md touched if a claim changed? -->
