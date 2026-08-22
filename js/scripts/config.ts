import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BuildOptions } from "esbuild";
import { watchBuildOptions } from "../esbuild/preset.mts";

/** One per-target esbuild build (app | widget). */
export interface BuildTarget {
  name: string;
  /** Native target this bundle runs on (codegen/schema.ts `targets`). */
  schemaTarget: string;
  entry: string;
  outfile: string;
  asset: string;
  budgetKB: number;
  /** Declared capability contract (ARCH-02): native features the bundle needs. */
  requiredFeatures: string[];
}

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
// the build can check `declared ⊆ what that binary provides` (codegen/schema.ts
// `hostMethods`). Keep these in sync with the features the entry actually uses
// (under-declaring isn't caught automatically — see releaseContract.mjs).
export const targets: BuildTarget[] = [
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
      "location",
      "workoutPlans",
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
    // trades against MEMORY, not (bytecode) boot. Do NOT match the app's ceiling
    // (docs/budgets-and-limits.md).
    //
    // Lowered 1000 -> 100 KB when the widget path stopped rendering timelines
    // through react-reconciler (src/staticRender.ts): the demo widget bundle
    // went 153,362 -> 27,870 B minified, because the reconciler + scheduler +
    // renderer adapter were 83.8% of it and existed only for a one-shot static
    // render. 100 KB is ~3.5x the current bundle — generous for real widget
    // code — while still failing loudly if the reconciler (~121 KB) is ever
    // dragged back into this graph by a stray import. That regression is
    // invisible at 1 MB, which is exactly why the old budget never caught it.
    budgetKB: 100,
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

export function buildOptions({
  // Stays OFF while the published preset's `buildBundles` defaults ON: this is
  // the REPO's own `pnpm build`, which the test suite reads as a fixture —
  // test/react-compiler.test.ts asserts the bundle contains
  // "react/compiler-runtime", a string minification erases. `build:min` is the
  // minified artifact; flipping this default would fail that test, not ship
  // anything.
  minify = false,
  target = targets[0],
}: {
  minify?: boolean;
  target?: BuildTarget;
} = {}): BuildOptions {
  const otaUrl = process.env.REACT_WATCH_OTA_URL ?? "";
  // The demo build is the shared QuickJS preset (shim inject, es2020,
  // neutral IIFE) with the React Compiler enabled — the same published flag
  // consumers use (NF-28), auto-memoizing components so React re-renders
  // less and emits fewer commits. Runs before bundling.
  const options = watchBuildOptions({
    entry: target.entry,
    outfile: target.outfile,
    minify,
    // Derived from the SAME declared contract the OTA manifest and the ARCH-01
    // capability gate read, rather than a second hand-maintained flag that
    // could disagree with it: a bundle that never declared `network` has no
    // business carrying the fetch shim (-3,798 B on the widget). Declaring the
    // feature is therefore what turns the shim back on — one edit, not two.
    network: target.requiredFeatures.includes("network"),
    reactCompiler: true,
  });
  options.define = {
    ...options.define,
    "process.env.REACT_WATCH_OTA_URL": JSON.stringify(otaUrl),
    "process.env.BUNDLE_VERSION": JSON.stringify(String(bundleVersion)),
  };
  return options;
}
