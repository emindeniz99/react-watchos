// dependency-cruiser — ARCHITECTURE rules only.
//
// Not a general lint pass: Biome owns style, knip owns dead code, tsc owns
// types. This file encodes the three boundaries that are load-bearing for this
// package and that no other tool can see, because they are about WHICH ENGINE
// a file ends up running in:
//
//   src/       -> bundled by esbuild/Metro and evaluated inside QuickJS on the
//                 watch. No node: builtins, no filesystem, ES2020.
//   esbuild/   -> runs on Node, in the consumer's build. Node 24 + fs + esbuild.
//   plugin/    -> runs on Node, inside `expo prebuild`. CommonJS (.cts).
//   codegen/   -> runs on Node and WRITES src/generated/. Depending on src
//                 would make the generator read its own output.
//   demo/,test/-> consumers of src, never the reverse.
//
// A violation of any of these is not a smell, it is a bundle that breaks at
// boot (a `node:fs` import reaching QuickJS) or a generator that can't run from
// a clean checkout. Hence severity "error" throughout.
/** @type {import('dependency-cruiser').IConfiguration} */
export default {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment:
        "A cycle inside the renderer is a real hazard here, not a style point: the " +
        "bundle is evaluated once in a fresh QuickJS context, and a cycle makes the " +
        "module-init ORDER decide whether a binding is initialised — the failure mode " +
        "is a TDZ ReferenceError at boot on the watch, which nothing on Linux reproduces.",
      from: { path: "^src/" },
      to: {
        circular: true,
        // `viaOnly` = report only cycles in which EVERY edge is a runtime
        // edge. This is a suppression with a reason, not a convenience:
        // tsconfig.base.json sets `verbatimModuleSyntax`, so an
        // `import type { … }` edge is erased before the bundler ever sees it
        // and cannot participate in a module-init order. The single cycle in
        // the graph today is exactly that shape —
        // events.ts ──type──▶ renderer.ts ──value──▶ events.ts, for the
        // `Instance` fiber type — and calling it a boot hazard would be false.
        // Add one VALUE edge anywhere in that loop and the rule fires again.
        viaOnly: { dependencyTypesNot: ["type-only"] },
      },
    },
    {
      name: "src-is-not-a-consumer",
      severity: "error",
      comment:
        "src/ is the published library. demo/ and test/ are consumers of it and are " +
        "NOT in the `files` allowlist for demo/test — an import the other way would " +
        "ship a demo screen (or a vitest import) into every consumer's watch bundle.",
      from: { path: "^src/" },
      to: { path: "^(demo|test)/" },
    },
    {
      name: "node-tooling-is-not-in-the-watch-bundle",
      severity: "error",
      comment:
        "esbuild/ and plugin/ run on NODE (the consumer's build, and `expo prebuild`); " +
        "src/ runs in QuickJS on the watch. The boundary holds today in both " +
        "directions and must keep holding: pulling src/ into the preset would drag " +
        "react + react-reconciler into a build-time dependency, and pulling the preset " +
        "into src/ would put `node:fs` in the watch bundle.",
      from: { path: "^(esbuild|plugin)/" },
      to: { path: "^src/" },
    },
    {
      name: "codegen-does-not-read-its-own-output",
      severity: "error",
      comment:
        "codegen/ generates src/generated/wire.ts (and the Swift mirrors) from " +
        "codegen/schema.ts. If it imported src/, `codegen --check` on a clean " +
        "checkout would depend on the artifact it is about to write, and the drift " +
        "gate in ci.yml would be self-confirming.",
      from: { path: "^codegen/" },
      to: { path: "^src/" },
    },
    {
      name: "no-unresolvable",
      severity: "error",
      comment:
        "A specifier dependency-cruiser cannot resolve is either a typo or a missing " +
        "dependency — both break the bundle. `preserveSymlinks` is off, so the pnpm " +
        "workspace's symlinked deps resolve normally.",
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    // "specify" = keep type-only imports in the graph AND tag them
    // `type-only`. Both halves matter: the boundary rules SHOULD see a
    // `import type { X } from "../src/…"` in the preset (it still couples the
    // build to the renderer's shape), while no-circular should not (see its
    // comment above).
    tsPreCompilationDeps: "specify",
    // The tooling config is the one that knows about .mts/.cts and
    // allowImportingTsExtensions — src/ resolves fine under it too.
    tsConfig: { fileName: "tsconfig.tooling.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
