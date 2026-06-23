#!/usr/bin/env node
// Merges each apple-target's `infoPlist` (from its expo-target.config.js) into
// the Info.plist that @bacons/apple-targets generates, run AFTER `expo prebuild`.
//
// Why a post-prebuild step: apple-targets@4.0.7 writes targets/<name>/Info.plist
// ONLY when absent, and for `type: "watch"` the template it writes is an empty
// `<dict/>`. It never merges the `infoPlist` key from expo-target.config.js. So
// keys we rely on — CFBundleURLTypes (the `reactwatch://` deep-link scheme),
// WKRunsIndependentlyOfCompanionApp (standalone watch app), the HealthKit /
// CoreBluetooth / CoreMotion usage strings — would silently never reach the
// built app. The Info.plist is gitignored (a generated artifact), so we can't
// just commit it; expo-target.config.js stays the single source of truth and
// this script applies it. Idempotent: config values overwrite, so re-running
// (or running when already merged) converges to the same file.

const fs = require("node:fs");
const path = require("node:path");

// `plist` is a transitive dep (of config-plugins / apple-targets), not hoisted
// next to this script under pnpm — resolve it through a package that owns it.
function loadPlist() {
  for (const base of ["@expo/config-plugins", "@bacons/apple-targets"]) {
    try {
      return require(
        require.resolve("plist", { paths: [path.dirname(require.resolve(base))] }),
      );
    } catch {}
  }
  return require("plist");
}

// Deep-merge `source` into `target`: nested plain objects merge recursively,
// everything else (scalars, arrays) is replaced by the source value.
function deepMerge(target, source) {
  if (!isPlainObject(target) || !isPlainObject(source)) return source;
  const out = { ...target };
  for (const [key, value] of Object.entries(source)) {
    out[key] = isPlainObject(value) ? deepMerge(target[key], value) : value;
  }
  return out;
}

function isPlainObject(value) {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value)
  );
}

const plist = loadPlist();
const targetsDir = path.join(__dirname, "..", "targets");
if (!fs.existsSync(targetsDir)) {
  console.error(`[merge-target-infoplist] no ${targetsDir}; nothing to do`);
  process.exit(0);
}

let merged = 0;
for (const name of fs.readdirSync(targetsDir)) {
  const targetDir = path.join(targetsDir, name);
  const configPath = path.join(targetDir, "expo-target.config.js");
  const plistPath = path.join(targetDir, "Info.plist");
  if (!fs.existsSync(configPath) || !fs.existsSync(plistPath)) continue;

  const configFn = require(configPath);
  const infoPlist = (typeof configFn === "function" ? configFn({}) : configFn)
    ?.infoPlist;
  if (!infoPlist || Object.keys(infoPlist).length === 0) continue;

  const current = plist.parse(fs.readFileSync(plistPath, "utf8"));
  const next = deepMerge(current, infoPlist);
  const before = plist.build(current);
  const after = plist.build(next);
  if (before !== after) {
    fs.writeFileSync(plistPath, after);
    console.log(`[merge-target-infoplist] merged infoPlist into ${name}/Info.plist`);
    merged += 1;
  }
}

if (!merged) console.log("[merge-target-infoplist] all target Info.plists already current (no-op)");
