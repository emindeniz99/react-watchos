// Compiles the Node-LOADED surfaces of the package (bin/, plugin/, esbuild/)
// to plain JS in dist-node/, because Node refuses native type stripping for
// files under node_modules (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING). A
// registry install therefore cannot run the shipped .cts/.mts sources; it runs
// these compiled bundles instead. src/ stays source-shipped — it is consumed
// by the app's bundler, never loaded by Node directly.
//
// Layout (dist-node/ sits DIRECTLY under js/ on purpose: preset.mts computes
// `rendererRoot = dirname(import.meta.url)/..`, so an output one level deep
// keeps that ".." pointing at the package root, same as esbuild/):
//   react-watchos.cjs          <- bin/react-watchos.cts        (package bin)
//   plugin.cjs                 <- plugin/index.cts             (app.plugin.js)
//   link-swift-package.cjs     <- plugin/link-swift-package.cts
//   merge-target-infoplist.cjs <- plugin/merge-target-infoplist.cts
//   preset.mjs                 <- esbuild/preset.mts           ("./build")
//   manifest.mjs               <- esbuild/manifest.mts         ("./manifest")
//
// Each entry bundles its RELATIVE imports (so no .cts/.mts extension rewriting
// is needed) while every npm dependency stays external (`packages:
// "external"`); dynamic `require(expr)` calls (peerDeps.cts) survive as real
// requires because the output format is cjs. Runs via `prepare` (workspace
// install + npm pack/publish) and `build:node`.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "esbuild";

const jsRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(jsRoot, "dist-node");

rmSync(outDir, { recursive: true, force: true });

// CJS output has no `import.meta.url`, but preset.mts (bundled into the bin
// for `react-watchos build`/`dev`) anchors rendererRoot on it. Standard esbuild
// recipe: define it to an injected var computed from __filename — which is the
// OUTPUT file, so dist-node/<bin>.cjs resolves the same package root.
const importMetaUrlShim = join(outDir, "_import-meta-url-shim.js");

const shared = {
  absWorkingDir: jsRoot,
  bundle: true,
  platform: "node",
  target: "node22",
  packages: "external",
  outdir: outDir,
  logLevel: "warning",
} as const;

// esbuild classifies a module with ANY `export` keyword as ESM — including the
// type-only `export interface` several plugin .cts files carry next to their
// runtime `module.exports = …`. In an ESM-classified module that assignment
// hits the bundle's outer `module` and the file's real exports become an empty
// namespace (importers would destructure undefined). Node's own type stripping
// has no such confusion: it blanks the types, leaving plain CJS. So feed
// esbuild EXACTLY what Node executes — strip the .cts sources with
// stripTypeScriptTypes before esbuild parses them.
const stripCts: Plugin = {
  name: "strip-cts-types",
  setup(b) {
    b.onLoad({ filter: /\.cts$/ }, (args) => ({
      contents: stripTypeScriptTypes(readFileSync(args.path, "utf8")),
      loader: "js",
      resolveDir: dirname(args.path),
    }));
  },
};

mkdirSync(outDir, { recursive: true });
writeFileSync(
  importMetaUrlShim,
  'export var import_meta_url = require("node:url").pathToFileURL(__filename).href;\n',
);

await build({
  ...shared,
  entryPoints: {
    "react-watchos": "bin/react-watchos.cts",
    plugin: "plugin/index.cts",
    "link-swift-package": "plugin/link-swift-package.cts",
    "merge-target-infoplist": "plugin/merge-target-infoplist.cts",
  },
  format: "cjs",
  outExtension: { ".js": ".cjs" },
  define: { "import.meta.url": "import_meta_url" },
  inject: [importMetaUrlShim],
  plugins: [stripCts],
});

await build({
  ...shared,
  entryPoints: {
    preset: "esbuild/preset.mts",
    manifest: "esbuild/manifest.mts",
  },
  format: "esm",
  outExtension: { ".js": ".mjs" },
});

rmSync(importMetaUrlShim, { force: true });

// stderr, not stdout: `prepare` runs inside `npm pack --json`, whose stdout
// must stay machine-parseable JSON.
console.error("[build-node] compiled bin/plugin/esbuild surfaces -> dist-node/");
