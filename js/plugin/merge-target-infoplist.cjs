#!/usr/bin/env node
// Manual fallback for the target Info.plist merge.
//
// The config plugin now merges each target's `infoPlist` DURING `expo prebuild`
// (plugin/withNativeWiring.js), so you normally don't run this. It stays as a
// manual recovery if the in-prebuild wiring is skipped (it's wrapped to never
// fail prebuild). Delegates to the SAME `mergeTargetInfoPlists` the plugin uses.
//
// Why the merge is needed at all: apple-targets@4.x writes targets/<dir>/
// Info.plist ONLY when absent, and for `type: "watch"` the template is an empty
// `<dict/>`; it never merges the `infoPlist` from expo-target.config.js. So keys
// the watch app relies on — the reactwatch:// URL scheme,
// WKRunsIndependentlyOfCompanionApp, the HealthKit/CoreBluetooth/CoreMotion
// usage strings — would never reach the built app. Idempotent.
//
// Usage (from the consumer's project root, after prebuild):
//   node node_modules/react-watchos/plugin/merge-target-infoplist.cjs [--project-root <dir>]

const path = require("node:path");
const { mergeTargetInfoPlists } = require("./withNativeWiring");

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const projectRoot = path.resolve(arg("--project-root") ?? process.cwd());
const merged = mergeTargetInfoPlists(projectRoot);
console.log(
  merged.length
    ? `[merge-target-infoplist] merged infoPlist into ${merged.join(", ")}`
    : "[merge-target-infoplist] all target Info.plists already current (no-op)",
);
