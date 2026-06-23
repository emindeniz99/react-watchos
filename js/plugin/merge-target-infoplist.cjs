#!/usr/bin/env node
// Merges each react-native-watchos target's `infoPlist` (from the generated
// targets/<dir>/expo-target.config.js) into the Info.plist that
// @bacons/apple-targets writes, run AFTER `expo prebuild`.
//
// Why a post-prebuild step: apple-targets@4.x writes targets/<dir>/Info.plist
// ONLY when absent, and for `type: "watch"` the template it writes is an empty
// `<dict/>`. It never merges the `infoPlist` key from expo-target.config.js. So
// keys the watch app relies on — CFBundleURLTypes (the `reactwatch://`
// deep-link scheme), WKRunsIndependentlyOfCompanionApp (standalone watch app),
// the HealthKit / CoreBluetooth / CoreMotion usage strings — would silently
// never reach the built app. The Info.plist is a generated artifact, so we
// re-apply the resolved infoPlist here. Idempotent: config values overwrite, so
// re-running (or running when already merged) converges to the same file.
//
// Reuses the package's pure deepMerge so the merge semantics are unit-tested.
//
// Usage (from the consumer's project root, after prebuild):
//   node node_modules/react-native-watchos/plugin/merge-target-infoplist.cjs [--project-root <dir>]

const fs = require("node:fs");
const path = require("node:path");
const { loadPlist } = require("./peerDeps");
const { deepMerge } = require("./mergeInfoPlist");
const { readGeneratedTargets } = require("./readTargets.cjs");

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const projectRoot = path.resolve(arg("--project-root") ?? process.cwd());
const plist = loadPlist(projectRoot);
const targetsDir = path.join(projectRoot, "targets");

let merged = 0;
for (const { dir, config } of readGeneratedTargets(projectRoot)) {
  const infoPlist = config.infoPlist;
  if (!infoPlist || Object.keys(infoPlist).length === 0) continue;
  const plistPath = path.join(targetsDir, dir, "Info.plist");
  if (!fs.existsSync(plistPath)) continue;

  const current = plist.parse(fs.readFileSync(plistPath, "utf8"));
  const next = deepMerge(current, infoPlist);
  const before = plist.build(current);
  const after = plist.build(next);
  if (before !== after) {
    fs.writeFileSync(plistPath, after);
    console.log(`[merge-target-infoplist] merged infoPlist into ${dir}/Info.plist`);
    merged += 1;
  }
}

if (!merged) {
  console.log("[merge-target-infoplist] all target Info.plists already current (no-op)");
}
