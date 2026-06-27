# Decision: esbuild for the watch/widget bundle (revisit: Rolldown)

**Status:** current (verified 2026-06). **Scope:** the JS→watch bundle only —
*not* the iPhone app (that's Metro, see below).

## The job

We compile React into **one self-contained IIFE** that QuickJS `eval`s on the
watch. This is unusual: no DOM, no Hermes, no Metro runtime, no HMR at runtime.
Requirements: a single file, `format: iife`, ES2020, platform-neutral,
tree-shaken, **fast and deterministic**, and able to run the React Compiler
(a Babel plugin) in the pipeline.

The bundler is isolated behind `react-native-watchos/build`
(`watchBuildOptions` / `buildBundles`) — a consumer never calls esbuild
directly, so swapping the engine is a one-file change in the package.

## Decision

**esbuild.** In mid-2026 it's still the best pragmatic fit: actively maintained
(0.28.x, June 2026; ~238M downloads/week), first-class IIFE output, default
tree-shaking, trivial one-call API. It does not run Babel plugins — by design —
so the React Compiler runs as a separate Babel transform. That's not a
disadvantage: React Compiler still ships canonically as a Babel plugin in 2026,
so **every** bundler needs a separate Babel step.

## Alternatives considered

| Tool | Verdict for THIS job |
|---|---|
| **Metro** | RN/Expo default — but emits an RN-runtime module-registry format, **no IIFE**. Correct for the iPhone app, wrong for the watch bundle. We use it for the app, esbuild for the watch. |
| **Vite** | A dev-server / app build tool, browser-centric. Its `build.lib` just delegates to Rollup/Rolldown — you'd carry the whole app/HTML/dev-server apparatus to emit a single IIFE you already get from esbuild. Wrong category. |
| **Rollup** | Works (great tree-shaking, native IIFE, clean Babel), but slower than esbuild and plateauing (Vite 8 dropped it for Rolldown). No reason to move *to* it. |
| **Bun bundler** | Fast, growing, but IIFE output is still flagged experimental/buggy and it can't run Babel plugins. Not yet. |
| **webpack / Turbopack** | App-focused, heavy config / Next-coupled. Overkill. |
| **swc / tsup / tsdown** | Transform engine (swc) or convenience CLIs over esbuild/Rolldown — no new capability for a single programmatic `build()` we already have. |

## The one to watch: Rolldown

**Rolldown** (Rust, from the Vite team / VoidZero) hit **1.0 stable in May 2026**
and is now Vite 8's engine. It's the one credible future successor — Rollup-
compatible API, `iife` output, native Oxc transforms, and it can run the React
Compiler via `@rolldown/plugin-babel`.

**Revisit if:** (a) we want Oxc-native JSX/TS to drop the Babel step, or (b)
esbuild's bus factor (effectively one maintainer) genuinely worsens.

**Two caveats to validate before switching:**
1. Rolldown's *output* heuristics (DCE/chunking/inlining) are **not frozen
   across minors** — in mild tension with our "deterministic bundle" goal.
2. `@rolldown/plugin-babel` (the React-Compiler bridge) is still 0.x.

Governance note: VoidZero was acquired by Cloudflare (2026-06); Vite/Rolldown/Oxc
pledged to stay MIT/OSS. No near-term risk, but worth tracking for a long bet.

## Bottom line

Stay on esbuild now. Keep the React-Compiler-as-Babel-step architecture (it's
bundler-agnostic and future-proof). Re-evaluate Rolldown when one of the
triggers above fires; the swap is contained to the build preset.
