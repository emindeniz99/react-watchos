import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
  return {
    entryPoints: [join(root, "demo/entry.tsx")],
    outfile,
    bundle: true,
    format: "iife",
    // React Compiler auto-memoizes our components (fewer re-renders ->
    // fewer commits). Runs before bundling via Babel.
    plugins: [reactCompilerPlugin()],
    // Guarantees the QuickJS shims execute before react/scheduler module
    // init (they capture setTimeout & co. at load); import order in the
    // entry can no longer break this.
    inject: [join(root, "src/install-shims.ts")],
    // Bellard QuickJS (used in CI smoke tests) and quickjs-ng (on the
    // watch) both cover ES2020.
    target: "es2020",
    platform: "neutral",
    mainFields: ["module", "main"],
    conditions: ["import", "default"],
    define: { "process.env.NODE_ENV": '"production"' },
    minify,
    logLevel: "info",
  };
}
