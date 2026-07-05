import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { watchBuildOptions } from "../esbuild/preset.mjs";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Per-target builds (ARCH-03). The app bundle runs the full UI; the widget
// bundle only registers intent + timeline handlers (no App import), so the
// widget process never evaluates app code and ships far smaller. The app bundle
// keeps the name `dist/bundle.js` so the dev server, OTA manifest and dev-fetch
// URL are unchanged; each bundle still lands as `bundle.js` in its target's
// asset dir, so the native side (which loads the resource named "bundle") needs
// no change.
// `requiredFeatures` is the bundle's declared capability contract (ARCH-02): the
// native features it needs, so the build can stamp them into the OTA manifest and
// the ARCH-01 gate refuses to apply a bundle a binary can't run — no hand-passing
// at applyUpdate time. `schemaTarget` maps each bundle to its native target so
// the build can check `declared ⊆ what that binary provides` (codegen/schema.mjs
// `hostMethods`). Keep these in sync with the features the entry actually uses
// (under-declaring isn't caught automatically — see releaseContract.mjs).
export const targets = [
  {
    name: "app",
    schemaTarget: "watch",
    entry: join(root, "demo/app.entry.tsx"),
    outfile: join(root, "dist/bundle.js"),
    asset: join(root, "../app/targets/watch/assets/bundle.js"),
    // Sanity ceiling, not a boot-parse tripwire (docs/budgets-and-limits.md).
    // Prod ships precompiled bytecode (build:bytecode -> bundle.qbc), so parse
    // is BUILD-time, not boot — proven on-sim (bytecode read ~2 ms vs ~44 ms
    // parse). A bigger app bundle costs flash + app QuickJS heap (64 MB cap) +
    // OTA. The real app ceiling is the OTA cap (maxOTABundleBytes = 3 MB): a
    // bundle above it still ships in the binary but can't be OTA-updated. 2 MB
    // keeps OTA margin + generous dev headroom; raise maxOTABundleBytes too if
    // you ever want >3 MB and still OTA it.
    budgetKB: 2000,
    // The demo app exercises everything except sensors: storage, widgets,
    // haptics, BLE, on-device AI, OTA (fetchAndApplyUpdate → network + ota),
    // phone connectivity, notifications.
    requiredFeatures: [
      "storage",
      "widgets",
      "haptics",
      "bluetooth",
      "ai",
      "network",
      "ota",
      "connectivity",
      "notifications",
    ],
  },
  {
    name: "widget",
    schemaTarget: "widget",
    entry: join(root, "demo/widget.entry.tsx"),
    outfile: join(root, "dist/widget.bundle.js"),
    asset: join(root, "../app/targets/widget/assets/bundle.js"),
    // Kept far tighter than the app: the widget bundle's bytecode loads into the
    // extension's 16 MB JS heap under the ~30 MB WidgetKit limit, so size here
    // trades against MEMORY, not (bytecode) boot. 1 MB is ~6% of the heap —
    // safe; do NOT match the app's ceiling (docs/budgets-and-limits.md).
    budgetKB: 1000,
    // The widget bundle only reads/writes shared state and publishes timelines.
    requiredFeatures: ["storage", "widgets"],
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
  // neutral IIFE) with the React Compiler enabled — the same published flag
  // consumers use (NF-28), auto-memoizing components so React re-renders
  // less and emits fewer commits. Runs before bundling.
  const options = watchBuildOptions({
    entry: target.entry,
    outfile: target.outfile,
    minify,
    reactCompiler: true,
  });
  options.define = {
    ...options.define,
    "process.env.REACT_WATCH_OTA_URL": JSON.stringify(otaUrl),
    "process.env.BUNDLE_VERSION": JSON.stringify(String(bundleVersion)),
  };
  return options;
}
