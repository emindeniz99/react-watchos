# Quality gates — lightweight, no server

What we use to catch code smells / cognitive complexity / security issues, given
two hard constraints: **no server** (no SonarQube/SonarCloud backend, no Docker/
JVM) and **automatic rules** (ready-made best-practice rulesets, not hand-written
ones). Split by TS and Swift because the tooling differs sharply.

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
