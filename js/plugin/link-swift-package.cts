#!/usr/bin/env node
// Manual fallback for linking the react-watchos SwiftPM host products
// into the generated watch + widget targets.
//
// The config plugin now does this DURING `expo prebuild` (plugin/
// withNativeWiring.js registers its own xcode base mod that runs after
// @bacons/apple-targets has created the targets), so you normally don't run
// this. It stays as a manual recovery if the in-prebuild wiring is skipped
// (it's wrapped to never fail prebuild). Idempotent: re-running (or running
// when already linked) changes nothing.
//
// Reuses the package's own pure logic (wireLocalPackage / resolveSwiftPackage)
// so there is no duplicated pbxproj surgery. The watch/widget target NAMES and
// which products each needs are read back from the targets/<dir>/
// expo-target.config.js files the plugin generated during prebuild — the same
// resolved source of truth, no Expo-config re-parsing.
//
// Usage (from the consumer's project root, after prebuild):
//   node node_modules/react-watchos/plugin/link-swift-package.cjs [--project-root <dir>]

const fs = require("node:fs");
const path = require("node:path");
const { loadXcode } = require("./peerDeps.cts");
const {
  wireLocalPackage,
  HOST_PRODUCTS,
  WIDGET_PRODUCTS,
} = require("./wireLocalPackage.cts");
const { swiftPackageRelativePath } = require("./resolveSwiftPackage.cts");
const { readGeneratedTargets } = require("./readTargets.cts");

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const projectRoot = path.resolve(arg("--project-root") ?? process.cwd());
const iosRoot = path.join(projectRoot, "ios");
const projName = fs.existsSync(iosRoot)
  ? fs.readdirSync(iosRoot).find((f: string) => f.endsWith(".xcodeproj"))
  : undefined;
if (!projName) {
  console.error(
    `[link-swift-package] no .xcodeproj under ${iosRoot}; run \`expo prebuild\` first`,
  );
  process.exit(1);
}

// target NAME -> SwiftPM products, by target type (watch host vs widget ext).
const targetProducts: Record<string, string[]> = {};
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
  console.log(
    `[link-swift-package] linked SwiftPM products: ${linked.join(", ")}`,
  );
} else {
  console.log("[link-swift-package] SwiftPM products already linked (no-op)");
}
