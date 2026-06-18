import { mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { watchBuildOptions } from "react-native-watchos/build";

// Builds the watch UI (watch-ui/) into the watch target's bundle resource.
// The whole config is the shared preset + this app's entry — nothing about
// QuickJS is copy-pasted here.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = join(root, "targets/watch/assets/bundle.js");
const minify = process.argv.includes("--minify") || !!process.env.MINIFY;

mkdirSync(dirname(outfile), { recursive: true });
await build(
  watchBuildOptions({
    entry: join(root, "watch-ui/entry.tsx"),
    outfile,
    minify,
    nodePaths: [join(root, "node_modules")],
  }),
);

const kb = (statSync(outfile).size / 1024).toFixed(0);
console.log(`watch bundle: ${kb} KB${minify ? " (minified)" : ""} -> ${outfile}`);
