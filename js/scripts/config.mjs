import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { watchBuildOptions } from "../esbuild/preset.mjs";
import { reactCompilerPlugin } from "./react-compiler-plugin.mjs";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const outfile = join(root, "dist/bundle.js");

// Shipped as a resource of both targets: the watch app evaluates it to
// run the UI; the widget extension evaluates it to handle control
// intents and refresh timelines.
export const assets = [
  join(root, "../app/targets/watch/assets/bundle.js"),
  join(root, "../app/targets/widget/assets/bundle.js"),
];

/** @returns {import("esbuild").BuildOptions} */
export function buildOptions({ minify = false } = {}) {
  const otaUrl = process.env.REACT_WATCH_OTA_URL ?? "";
  // The demo build is the shared QuickJS preset (shim inject, es2020,
  // neutral IIFE) plus the React Compiler plugin, which auto-memoizes our
  // components (fewer re-renders -> fewer commits). Runs before bundling.
  const options = watchBuildOptions({
    entry: join(root, "demo/entry.tsx"),
    outfile,
    minify,
    plugins: [reactCompilerPlugin()],
  });
  options.define = {
    ...options.define,
    "process.env.REACT_WATCH_OTA_URL": JSON.stringify(otaUrl),
  };
  return options;
}
