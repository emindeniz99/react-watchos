# Quality gates — lightweight, no server

What we use to catch code smells / cognitive complexity / security issues, given
two hard constraints: **no server** (no SonarQube/SonarCloud backend, no Docker/
JVM) and **automatic rules** (ready-made best-practice rulesets, not hand-written
ones). Split by TS and Swift because the tooling differs sharply.

## The battery, as adopted (2026-08-21)

Everything below was first run as an **audit** — collect findings, fix the real
ones — and only the tools that produced signal became gates, each entering at a
zero-findings baseline so it is green on day one and a guard from day two.

Run the whole thing locally with **`pnpm --filter react-watchos quality`**.
`js/scripts/quality.sh` is the single definition of the flags;
[`quality.yml`](../.github/workflows/quality.yml) calls that script rather than
restating them. A standalone binary you don't have installed is a *skip with a
notice* locally (the `REQUIRE_QJS` posture) and a *failure* in CI, which sets
`REQUIRE_ALL_TOOLS=1`. It is intentionally **not** in the pre-push hook — that
has to stay fast.

| Tool | Pinned | What it gates | Config |
| --- | --- | --- | --- |
| **publint** | 0.3.23 | packaging correctness of the real `pnpm pack` tarball | — (`--strict`) |
| **attw** | 0.18.5 | do types resolve for every `exports` entry | flags + rationale in `quality.sh` |
| **knip** | 6.32.2 | dead files / exports / dependencies | [`js/knip.jsonc`](../js/knip.jsonc) |
| **dependency-cruiser** | 18.2.0 | the QuickJS-vs-Node module boundary, cycles | [`js/.dependency-cruiser.mjs`](../js/.dependency-cruiser.mjs) |
| **shellcheck** | 0.11.0 | every tracked `.sh` + `.githooks/pre-push` | — (`-x`) |
| **typos** | 1.45.0 | spelling in source, comments, docs | [`_typos.toml`](../_typos.toml) |
| **lychee** | 0.23.0 | internal links + `#anchors`, **offline** | [`lychee.toml`](../lychee.toml) |
| **CodeQL** | action v4.37.8 | TS/JS + the workflow files, default suite | [`codeql.yml`](../.github/workflows/codeql.yml) |

Report-only, never a gate:

- **coverage** (`@vitest/coverage-v8`, `pnpm coverage`) — `vitest.config.ts` has
  no `thresholds` key at all, so it cannot fail a build. CI prints the summary
  so a drop is visible in the log of the PR that caused it. A number nobody
  chose is not a quality bar.
- **lychee, external half** — weekly, `continue-on-error`. A third-party URL can
  404 with nothing here having changed.
- **cppcheck** — weekly, `continue-on-error`, over the four C files we own
  (`tools/embed-smoke`, `tools/vendored-qjs`, `tools/qjs-compile`; *not*
  `js/swift/Sources/CQuickJS`, which is upstream's). Weekly because it comes
  from the runner's apt repo, so GitHub picks its version — and everything that
  *gates* here is pinned to an exact release. Zero findings at adoption.

Two things the audit found that are worth remembering:

- **Biome had silently stopped linting the Node-side tooling.** `biome.json`
  still listed `scripts/**/*.mjs`, `plugin/**/*.{js,cjs}` and friends after
  those files became `.ts`/`.mts`/`.cts`, so 31 files — the whole config
  plugin, the preset helpers, codegen, bin, scripts — matched no glob and went
  unchecked, with `pnpm lint` green throughout. Fixed; Biome now sees 163 files
  where it saw 131.
- **A dead `#anchor` in the live budgets doc.** `#widget-memory-the-30-mb-story`
  had one hyphen where the em-dash heading slugs to two. Exactly the class
  `lychee --include-fragments` exists for.

### Rejected after measuring: eslint-plugin-sonarjs

Audited at 4.2.0 over `src/`, `esbuild/`, `plugin/`, `bin/`, `scripts/`,
`codegen/`, `demo/` — 85 files, **34 findings, zero real bugs**, and **not
wired**. The breakdown is the argument:

| Rule | n | Verdict |
| --- | --- | --- |
| `no-redundant-optional` | 8 | **Wrong for this codebase.** `tsconfig.base.json` sets `exactOptionalPropertyTypes`, which makes `x?: T \| undefined` the *required* spelling, not a redundant one. |
| `cognitive-complexity` | 6 | Biome already owns this, at a documented ratchet (below). Sonar's default of 15 would just re-report the debt we chose to freeze at 25. |
| `no-nested-template-literals` | 6 | Style. Biome deliberately doesn't enforce it. |
| `redundant-type-aliases` | 3 | `BleState = string`, `EventPriority = number`, `InvokeShapeRef = string` — deliberate documentation aliases, each with a doc block saying so. |
| `no-os-command-from-path` | 2 | `execFileSync("swift", …)` in dev-only codegen. |
| `no-nested-conditional` | 2 | Style. |
| `super-linear-regex` | 2 | The only class with teeth, and neither instance is reachable from untrusted input: `update.ts`'s `/[^/]*$/` runs on the developer-configured manifest URL (the remote-supplied `bundle` field goes through a linear test), and `symbolicate-core.ts` is a dev CLI over a crash log you hand it. |
| `todo-tag` | 2 | The repo's TODOs carry context on purpose. |
| `concise-regex`, `no-inverted-boolean-check` | 2 | Style. |

The cost is a second lint stack (eslint + typescript-eslint + the plugin, ~98
packages) running beside Biome, to gate nothing Biome doesn't already gate. The
2026-07 note below guessed this; these are the numbers behind it. Re-run the
audit if Biome's rule coverage ever stops tracking SonarJS.

## Verdict on SonarLint ("SonarQube for IDE")

Asked directly: **not our quality gate.** It's a good optional in-editor aid for
TS, useless for our Swift, and can't gate CI.

- **IDE-only, no CLI/CI.** SonarLint is exclusively a VS Code / JetBrains
  extension; there is no headless mode. The Sonar CI path is SonarScanner CLI,
  which **requires a SonarQube Server or Cloud** instance — i.e. the server we're
  excluding. ([docs](https://docs.sonarsource.com/sonarqube-for-vs-code))
- **Swift is Connected-Mode-only.** In standalone mode Swift gets **nothing** —
  Swift analysis lives on the commercial server/Cloud side. So for our SwiftPM
  package SonarLint offers zero. ([IntelliJ rules](https://docs.sonarsource.com/sonarqube-for-intellij/using/rules))
- **TS standalone is real but partial.** It surfaces code smells, bugs, and
  cognitive complexity for JS/TS locally and free — but **security hotspots and
  taint/injection analysis are Connected-Mode-only** (paid backend).
  ([VS Code rules](https://docs.sonarsource.com/sonarqube-for-vs-code/using/rules))

Bottom line: install the IDE extension if you personally like inline TS smells,
but it is not something we can wire into CI, and it does nothing for Swift.

## TypeScript — lean on Biome (already installed)

We already run **Biome** for lint+format, and Biome ships the SonarSource-style
gates directly — so **no second TS tool is needed** for the common case.

- **Adopted now — cognitive complexity as a ratchet.** `biome.json` enables
  [`noExcessiveCognitiveComplexity`](https://biomejs.dev/linter/rules/no-excessive-cognitive-complexity/)
  (Biome's implementation of Sonar cognitive complexity, configurable 1–254).
  The threshold is set to **25**, which is *today's worst function*, so the rule
  passes clean on all current code and **fails only on a regression above 25** —
  a gate, not a mandate to refactor. Tighten it over time as the debt below comes
  down (the Sonar default is 15).
- **Also on via Biome's recommended set:** the `security` group
  (`noGlobalEval`, …), `suspicious`, `correctness`, and the rest of `complexity`.
- **Current cognitive-complexity debt** (functions 16–25, to ratchet down when
  touched, not in a dedicated refactor pass): `src/widgets.ts` (25, 24),
  `plugin/wireLocalPackage.js` (22), `src/renderer.ts` (20), `src/update.ts`
  (19), `esbuild/preset.mjs` (18), `codegen/generate.mjs` / `src/navigation.tsx`
  (17), `src/navigation.tsx` / `src/fetch.ts` (16). These are legitimately dense
  hot paths (the reconciler commit, widget serialization, route matching); the
  ratchet stops them getting *worse* without demanding a churny rewrite now.

**Optional, deeper TS (only if we outgrow Biome):**

- **`eslint-plugin-sonarjs`** (SonarSource official) exposes the *full* SonarJS
  ruleset (400+ rules incl. cognitive-complexity, `no-duplicate-string`,
  `no-identical-functions`) as a pure ESLint plugin — "SonarQube smells without
  the server." The cost is adding ESLint alongside Biome (a second lint stack),
  so we don't take it now.
  ([repo](https://github.com/SonarSource/eslint-plugin-sonarjs))
  **Superseded 2026-08-21 — actually measured, still no:** see
  [§ Rejected after measuring](#rejected-after-measuring-eslint-plugin-sonarjs).
- **Semgrep** with public registry rulesets gives ready-made security rules with
  **zero rule-authoring**: `semgrep --config p/typescript --config p/react`
  (33 + 4 rules; XSS, SSRF, injection, insecure transport). It's a self-contained
  LGPL Python/OCaml CLI — **no Java, no server, no Docker** — with `--sarif`/
  `--json` and CI exit codes. Prefer explicit `p/...` over `--config auto` (which
  sends a hashed project URL to pick rules) and add `--metrics off` for zero
  telemetry; source code is never uploaded in any mode.
  ([registry](https://semgrep.dev/r), [metrics](https://docs.semgrep.dev/metrics))

## Swift — SwiftLint + Periphery, kept local

There is **no lightweight cognitive-complexity linter for Swift** — SonarQube is
the only tool that computes it, and only server-side. The lightweight, no-server
options give cyclomatic complexity and dead-code instead:

- **SwiftLint** — `cyclomatic_complexity` is on by default (a metrics rule); the
  opt-in analyzer rules `unused_declaration` / `unused_import` run via
  `swiftlint analyze` against a compiler log. Standalone CLI (`brew install
  swiftlint`) or a SwiftPM plugin. ([repo](https://github.com/realm/SwiftLint))
- **Periphery** — thorough dead-code detection (unused decls, enum cases,
  conformances) via the compiler index store. Use **`--retain-public`** because
  we ship interpreters/kernels as public API. ([repo](https://github.com/peripheryapp/periphery))

Both are **kept optional / local** (run when wanted, not wired into the build) to
respect the "no heavy installs" constraint — they need a `brew install` and a
build to analyze. Cognitive complexity for Swift is simply unavailable without a
Sonar server, so we accept `cyclomatic_complexity` as the closest proxy.

## Duplication — jscpd + human review

`jscpd` (token-based clone detector) stays for copy-paste detection. Its known
blind spot — structurally-different code around duplicated logic — is why the
[interpreter duplication](./human-review-2026-07-05-interpreter-duplication.md)
needed a hand review to size; no off-the-shelf clone detector (SonarQube's CPD
included, it's also token-based) reliably catches that class. Keep the human
read for the cases the tools structurally can't see.

## What we deliberately skip

**SonarQube Server / SonarCloud.** It's the only tool that would give us Swift
cognitive complexity and TS security hotspots/taint — but it's a heavy,
server-based, commercial-for-Swift stack, exactly the "no server / no heavy
install" line we're holding. The Biome ratchet + optional Semgrep/SwiftLint
cover the lightweight 80% without it.
