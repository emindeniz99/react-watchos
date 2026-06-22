#!/usr/bin/env node
// Authoritatively links the local SwiftPM package products into the generated
// watch + widget targets, run AFTER `expo prebuild`.
//
// Why a post-prebuild step and not just the config plugin: @bacons/apple-targets
// injects the "React Watch" / "React Watch Widgets" native targets through its
// own custom base mod, which writes the pbxproj at a point we can't reliably
// order our config-plugin mod after. So during prebuild the plugin only lands
// the package *reference*; the targets often don't exist yet, so the product
// *links* would silently no-op. By the time prebuild has finished, every target
// is on disk — so we re-open the pbxproj here and apply the links. Idempotent:
// re-running (or running when already linked) changes nothing.

const fs = require("node:fs");
const path = require("node:path");

const {
  wireLocalPackage,
  TARGET_PRODUCTS,
  PACKAGE_RELATIVE_PATH,
} = require("../plugins/wire-local-package.js");

// `xcode` is a transitive dep (of config-plugins / apple-targets), not hoisted
// next to this script under pnpm — resolve it through a package that owns it.
function loadXcode() {
  for (const base of ["@expo/config-plugins", "@bacons/apple-targets"]) {
    try {
      return require(
        require.resolve("xcode", { paths: [path.dirname(require.resolve(base))] }),
      );
    } catch {}
  }
  return require("xcode");
}

const iosRoot = path.join(__dirname, "..", "ios");
const projName = fs.existsSync(iosRoot)
  ? fs.readdirSync(iosRoot).find((f) => f.endsWith(".xcodeproj"))
  : undefined;
if (!projName) {
  console.error(
    `[link-swift-package] no .xcodeproj under ${iosRoot}; run \`expo prebuild\` first`,
  );
  process.exit(1);
}

const pbxPath = path.join(iosRoot, projName, "project.pbxproj");
const xcode = loadXcode();
const project = xcode.project(pbxPath);
project.parseSync();

const { linked } = wireLocalPackage(project, {
  packagePath: PACKAGE_RELATIVE_PATH,
  targetProducts: TARGET_PRODUCTS,
});
fs.writeFileSync(pbxPath, project.writeSync());

if (linked.length) {
  console.log(`[link-swift-package] linked SwiftPM products: ${linked.join(", ")}`);
} else {
  console.log("[link-swift-package] SwiftPM products already linked (no-op)");
}
