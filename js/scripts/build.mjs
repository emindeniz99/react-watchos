import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = join(root, "dist/bundle.js");
// Shipped as a resource of both targets: the watch app evaluates it to
// run the UI; the widget extension evaluates it to handle control intents.
const assets = [
  join(root, "../app/targets/watch/assets/bundle.js"),
  join(root, "../app/targets/widget/assets/bundle.js"),
];

await build({
  entryPoints: [join(root, "demo/entry.tsx")],
  outfile,
  bundle: true,
  format: "iife",
  // Bellard QuickJS (used in CI smoke tests) and quickjs-ng (on the watch)
  // both cover ES2020.
  target: "es2020",
  platform: "neutral",
  mainFields: ["module", "main"],
  conditions: ["import", "default"],
  define: { "process.env.NODE_ENV": '"production"' },
  minify: false,
  logLevel: "info",
});

for (const asset of assets) {
  mkdirSync(dirname(asset), { recursive: true });
  copyFileSync(outfile, asset);
  console.log(`copied bundle to ${asset}`);
}
