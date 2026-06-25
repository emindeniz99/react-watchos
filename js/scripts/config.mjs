import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { watchBuildOptions } from "../esbuild/preset.mjs";
import { reactCompilerPlugin } from "./react-compiler-plugin.mjs";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Per-target builds (ARCH-03). The app bundle runs the full UI; the widget
// bundle only registers intent + timeline handlers (no App import), so the
// widget process never evaluates app code and ships far smaller. The app bundle
// keeps the name `dist/bundle.js` so the dev server, OTA manifest and dev-fetch
// URL are unchanged; each bundle still lands as `bundle.js` in its target's
// asset dir, so the native side (which loads the resource named "bundle") needs
// no change.
export const targets = [
  {
    name: "app",
    entry: join(root, "demo/app.entry.tsx"),
    outfile: join(root, "dist/bundle.js"),
    asset: join(root, "../app/targets/watch/assets/bundle.js"),
    budgetKB: 200,
  },
  {
    name: "widget",
    entry: join(root, "demo/widget.entry.tsx"),
    outfile: join(root, "dist/widget.bundle.js"),
    asset: join(root, "../app/targets/widget/assets/bundle.js"),
    budgetKB: 160,
  },
];

// The app target's output path — the dev server serves it and OTA ships it.
export const outfile = targets[0].outfile;

// OTA compatibility version (CR-17). Single source of truth: stamped into
// dist/manifest.json by build.mjs and injected into the bundle (below) so the
// running app knows its own version for the freshness check. Monotonic — bump
// it ONLY on a breaking change (db schema / wire contract); the watch refuses
// any bundle older than the newest it has applied (anti-rollback). Keep the
// native `OTAConfig.shippedVersion` in lockstep with this when you ship.
export const bundleVersion = 1;

/** @returns {import("esbuild").BuildOptions} */
export function buildOptions({ minify = false, target = targets[0] } = {}) {
  const otaUrl = process.env.REACT_WATCH_OTA_URL ?? "";
  // The demo build is the shared QuickJS preset (shim inject, es2020,
  // neutral IIFE) plus the React Compiler plugin, which auto-memoizes our
  // components (fewer re-renders -> fewer commits). Runs before bundling.
  const options = watchBuildOptions({
    entry: target.entry,
    outfile: target.outfile,
    minify,
    plugins: [reactCompilerPlugin()],
  });
  options.define = {
    ...options.define,
    "process.env.REACT_WATCH_OTA_URL": JSON.stringify(otaUrl),
    "process.env.BUNDLE_VERSION": JSON.stringify(String(bundleVersion)),
  };
  return options;
}
