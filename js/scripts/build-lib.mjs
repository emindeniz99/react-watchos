import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// Compiles the package's public entries into lib/ for registry/Node consumers:
// ESM JavaScript (react/react-reconciler kept external — they're peers, so the
// consumer's single copy is used) plus compiled .d.ts (so consumers don't
// type-check our source under their own tsconfig). Bundler consumers get raw
// src via the exports `source`/`react-native` conditions instead.
//
// NB: dist/ is the watch *bundle* output; the library goes in lib/.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lib = join(root, "lib");
rmSync(lib, { recursive: true, force: true });

const external = [
  "react",
  "react-reconciler",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
];
const common = {
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2020",
  jsx: "automatic",
  external,
  logLevel: "info",
};

await build({
  ...common,
  entryPoints: [join(root, "src/index.ts")],
  outfile: join(lib, "index.js"),
});
await build({
  ...common,
  entryPoints: [join(root, "src/testing.ts")],
  outfile: join(lib, "testing.js"),
});

// Compiled type declarations.
execFileSync("npx", ["tsc", "-p", "tsconfig.build.json"], {
  cwd: root,
  stdio: "inherit",
});
console.log("lib/ built: index.js, testing.js, + .d.ts");
