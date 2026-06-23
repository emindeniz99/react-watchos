#!/usr/bin/env node
// Authoritatively links the react-native-watchos SwiftPM host products into the
// generated watch + widget targets, run AFTER `expo prebuild`.
//
// Why a post-prebuild step and not just the config plugin: @bacons/apple-targets
// injects the watch / widget native targets through its own custom base mod,
// which writes the pbxproj at a point the plugin's withXcodeProject mod can't
// reliably order after. So during prebuild the plugin only lands the package
// *reference*; the targets often don't exist yet, so the product *links* would
// silently no-op. By the time prebuild has finished, every target is on disk —
// so we re-open the pbxproj here and apply the links. Idempotent: re-running
// (or running when already linked) changes nothing.
//
// Reuses the package's own pure logic (wireLocalPackage / resolveSwiftPackage)
// so there is no duplicated pbxproj surgery. The watch/widget target NAMES and
// which products each needs are read back from the targets/<dir>/
// expo-target.config.js files the plugin generated during prebuild — the same
// resolved source of truth, no Expo-config re-parsing.
//
// Usage (from the consumer's project root, after prebuild):
//   node node_modules/react-native-watchos/plugin/link-swift-package.cjs [--project-root <dir>]

const fs = require("node:fs");
const path = require("node:path");
const { loadXcode } = require("./peerDeps");
const {
  wireLocalPackage,
  HOST_PRODUCTS,
  WIDGET_PRODUCTS,
} = require("./wireLocalPackage");
const { swiftPackageRelativePath } = require("./resolveSwiftPackage");
const { readGeneratedTargets } = require("./readTargets.cjs");

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const projectRoot = path.resolve(arg("--project-root") ?? process.cwd());
const iosRoot = path.join(projectRoot, "ios");
const projName = fs.existsSync(iosRoot)
  ? fs.readdirSync(iosRoot).find((f) => f.endsWith(".xcodeproj"))
  : undefined;
if (!projName) {
  console.error(
    `[link-swift-package] no .xcodeproj under ${iosRoot}; run \`expo prebuild\` first`,
  );
  process.exit(1);
}

// target NAME -> SwiftPM products, by target type (watch host vs widget ext).
const targetProducts = {};
for (const { name, type } of readGeneratedTargets(projectRoot)) {
  if (type === "watch") targetProducts[name] = HOST_PRODUCTS;
  else if (type === "watch-widget") targetProducts[name] = WIDGET_PRODUCTS;
}

const packagePath = swiftPackageRelativePath(projectRoot, iosRoot);
const pbxPath = path.join(iosRoot, projName, "project.pbxproj");
const xcode = loadXcode(projectRoot);
const project = xcode.project(pbxPath);
project.parseSync();

const { linked } = wireLocalPackage(project, { packagePath, targetProducts });
fs.writeFileSync(pbxPath, project.writeSync());

if (linked.length) {
  console.log(`[link-swift-package] linked SwiftPM products: ${linked.join(", ")}`);
} else {
  console.log("[link-swift-package] SwiftPM products already linked (no-op)");
}
