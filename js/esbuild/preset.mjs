// The QuickJS-correct esbuild preset, exported as `react-native-watchos/build`
// so consumers don't copy this config. It pins the settings the watch engine
// needs: the shims are force-injected before react/scheduler init, ES2020
// (both Bellard quickjs and quickjs-ng cover it), a platform-neutral IIFE
// (no Node/browser globals; one self-contained script the runtime evals).
//
// The preset resolves its OWN install-shims.ts, so a consumer only supplies
// their entry + outfile. `nodePaths` should point at the consumer's
// node_modules so the renderer's react/react-reconciler imports resolve to
// the consumer's single copy (see README — React dedupe).

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** This package's js/ root (build/ lives directly under it). */
export const rendererRoot = join(here, "..");

/** The shim entry esbuild must `inject` (captures setTimeout & co. first). */
export const shimEntry = join(rendererRoot, "src/install-shims.ts");

/**
 * esbuild BuildOptions for a QuickJS-targeted watch bundle.
 *
 * @param {object} opts
 * @param {string} opts.entry         App entry (e.g. src/entry.tsx).
 * @param {string} opts.outfile       Where to write the IIFE bundle.
 * @param {boolean} [opts.minify]     Minify (≈halves size; off keeps traces).
 * @param {string[]} [opts.nodePaths] Extra resolution roots (consumer's
 *                                    node_modules, for single-React dedupe).
 * @param {import("esbuild").Plugin[]} [opts.plugins] Extra plugins (e.g. the
 *                                    React Compiler, which the demo adds).
 * @returns {import("esbuild").BuildOptions}
 */
export function watchBuildOptions({
  entry,
  outfile,
  minify = false,
  nodePaths,
  plugins = [],
} = {}) {
  if (!entry) throw new Error("watchBuildOptions: `entry` is required");
  if (!outfile) throw new Error("watchBuildOptions: `outfile` is required");
  return {
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: "iife",
    inject: [shimEntry],
    target: "es2020",
    platform: "neutral",
    mainFields: ["module", "main"],
    conditions: ["import", "default"],
    define: { "process.env.NODE_ENV": '"production"' },
    plugins,
    ...(nodePaths ? { nodePaths } : {}),
    minify,
    logLevel: "info",
  };
}
