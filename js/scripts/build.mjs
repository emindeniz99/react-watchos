import {
  copyFileSync,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { build } from "esbuild";
import {
  assets,
  buildOptions,
  bundleVersion,
  outfile,
  root,
} from "./config.mjs";

// `npm run build -- --minify` (or MINIFY=1) roughly halves the bundle;
// unminified keeps watch-side stack traces readable during development.
const minify = process.argv.includes("--minify") || !!process.env.MINIFY;

await build(buildOptions({ minify }));

const kb = (statSync(outfile).size / 1024).toFixed(0);
console.log(`bundle: ${kb} KB${minify ? " (minified)" : ""}`);

// OTA manifest (CR-17): the freshness check fetches this to compare versions.
// `bundle` is relative so it resolves against wherever the manifest is served
// (the dev server serves dist/ statically, so /manifest.json + /bundle.js).
// `signature` is null here — sign "v1:<version>:<bundle>" at publish time with
// your Ed25519 key and fill it in; unsigned bundles load only in fail-open.
writeFileSync(
  join(root, "dist/manifest.json"),
  `${JSON.stringify({ version: bundleVersion, bundle: "bundle.js", signature: null }, null, 2)}\n`,
);
console.log(`manifest: version ${bundleVersion}`);

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
