import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { watchBuildOptions } from "react-watchos/build";

// The entire watch bundle config: the shared QuickJS preset + this app's
// entry. `nodePaths` points esbuild at THIS project's node_modules so the
// renderer's own react/react-reconciler imports resolve to our single copy
// (the React-dedupe requirement — see the renderer README).
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = join(root, "dist/bundle.js");
// Minified by default, because this is the artifact you copy into the watch
// target; see the `minify` JSDoc in `react-watchos/build` for the measured
// bytes/heap/boot. `--no-minify` (pnpm build:unminified) gives back the
// component names in stack traces; it is still a PRODUCTION build (the preset
// pins NODE_ENV=production), just a readable one.
const minify = !process.argv.includes("--no-minify");

await build(
  watchBuildOptions({
    entry: join(root, "src/entry.tsx"),
    outfile,
    minify,
    nodePaths: [join(root, "node_modules")],
  }),
);

const kb = (statSync(outfile).size / 1024).toFixed(0);
console.log(`bundle: ${kb} KB${minify ? " (minified)" : ""} -> ${outfile}`);
console.log("Copy dist/bundle.js to the watch target's assets/bundle.js.");
