import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBundles } from "react-native-watchos/build";

// Builds both watch bundles (ARCH-03: the app UI + the widget) in one call via
// the package's `buildBundles` helper — no per-target esbuild boilerplate, just
// the two things that differ (entry + outfile). The watch bundle bakes in
// REACT_WATCH_OTA_URL and gets an OTA `manifest.json` stamped next to it; the
// widget bundle is shipped, not OTA'd, so it needs neither.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const minify = process.argv.includes("--minify") || !!process.env.MINIFY;

await buildBundles(
  [
    {
      name: "watch",
      entry: join(root, "watch-ui/entry.tsx"),
      outfile: join(root, "targets/watch/assets/bundle.js"),
      // Inject the OTA endpoint the watch UI's "Check for update" reads (empty
      // unless you set REACT_WATCH_OTA_URL).
      define: {
        "process.env.REACT_WATCH_OTA_URL": JSON.stringify(
          process.env.REACT_WATCH_OTA_URL ?? "",
        ),
      },
      // OTA compatibility version — bump only on a breaking change; a
      // same-version release with a new releaseId is a hot fix. This UI uses
      // WatchConnectivity (connectivity) and OTA (network + ota).
      manifest: {
        version: 1,
        requiredFeatures: ["connectivity", "network", "ota"],
      },
    },
    {
      name: "widget",
      entry: join(root, "watch-ui/widget.entry.tsx"),
      outfile: join(root, "targets/widget/assets/bundle.js"),
    },
  ],
  { minify, nodePaths: [join(root, "node_modules")] },
);
