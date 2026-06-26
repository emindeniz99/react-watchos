import { mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { watchBuildOptions } from "react-native-watchos/build";

// Builds the WIDGET bundle (watch-ui/widget.entry.tsx) into the widget target's
// asset. Same preset as the watch bundle — just a different entry and output.
// The widget bundle registers widgets (no runApp); it is shipped, not OTA'd (the
// app bundle is what runs checkForUpdate), so there's no manifest to stamp here.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = join(root, "targets/widget/assets/bundle.js");
const minify = process.argv.includes("--minify") || !!process.env.MINIFY;

mkdirSync(dirname(outfile), { recursive: true });
await build(
  watchBuildOptions({
    entry: join(root, "watch-ui/widget.entry.tsx"),
    outfile,
    minify,
    nodePaths: [join(root, "node_modules")],
  }),
);

const kb = (statSync(outfile).size / 1024).toFixed(0);
console.log(`widget bundle: ${kb} KB${minify ? " (minified)" : ""} -> ${outfile}`);
