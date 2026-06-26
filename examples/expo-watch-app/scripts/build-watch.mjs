import { mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { watchBuildOptions } from "react-native-watchos/build";
import { writeOTAManifest } from "react-native-watchos/manifest";

// Builds the watch UI (watch-ui/) into the watch target's bundle resource.
// The whole config is the shared preset + this app's entry — nothing about
// QuickJS is copy-pasted here.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(root, "targets/watch/assets");
const outfile = join(distDir, "bundle.js");
const minify = process.argv.includes("--minify") || !!process.env.MINIFY;

// OTA compatibility version. Bump only on a breaking change (an API the staged
// bundle needs that the installed binary can't provide); a same-version release
// with a new releaseId is a hot fix the watch picks up automatically.
const version = 1;

mkdirSync(distDir, { recursive: true });
const options = watchBuildOptions({
  entry: join(root, "watch-ui/entry.tsx"),
  outfile,
  minify,
  nodePaths: [join(root, "node_modules")],
});
// Inject the OTA endpoint the watch UI's "Check for update" reads. Empty unless
// you set REACT_WATCH_OTA_URL — then the build bakes it into the bundle.
options.define = {
  ...options.define,
  "process.env.REACT_WATCH_OTA_URL": JSON.stringify(
    process.env.REACT_WATCH_OTA_URL ?? "",
  ),
};
await build(options);

// Stamp the OTA manifest next to the bundle. Serve this directory from any
// static host (the watch fetches <REACT_WATCH_OTA_URL>/manifest.json, compares
// its releaseId, and stages the bundle if it's fresher). requiredFeatures is
// this UI's capability contract: it uses WatchConnectivity (connectivity) and
// fetches updates (network + ota).
const manifest = writeOTAManifest({
  distDir,
  version,
  requiredFeatures: ["connectivity", "network", "ota"],
});

const kb = (statSync(outfile).size / 1024).toFixed(0);
console.log(`watch bundle: ${kb} KB${minify ? " (minified)" : ""} -> ${outfile}`);
console.log(`OTA manifest: v${manifest.version}, releaseId ${manifest.releaseId}`);
