import { copyFileSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { build } from "esbuild";
import { assets, buildOptions, outfile } from "./config.mjs";

// `npm run build -- --minify` (or MINIFY=1) roughly halves the bundle;
// unminified keeps watch-side stack traces readable during development.
const minify = process.argv.includes("--minify") || !!process.env.MINIFY;

await build(buildOptions({ minify }));

const kb = (statSync(outfile).size / 1024).toFixed(0);
console.log(`bundle: ${kb} KB${minify ? " (minified)" : ""}`);

for (const asset of assets) {
  mkdirSync(dirname(asset), { recursive: true });
  copyFileSync(outfile, asset);
  console.log(`copied bundle to ${asset}`);
  // Drop any stale precompiled bytecode beside it: a JS-only build must never
  // ship a .qbc that's out of sync with this fresh source. `build:bytecode`
  // regenerates it from the bundle (with the vendored quickjs-ng) when run.
  rmSync(asset.replace(/bundle\.js$/, "bundle.qbc"), { force: true });
}
// Same invalidation for the dist/ source of truth.
rmSync(outfile.replace(/bundle\.js$/, "bundle.qbc"), { force: true });
