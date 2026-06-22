const { withXcodeProject, createRunOncePlugin } = require("@expo/config-plugins");
const {
  wireLocalPackage,
  TARGET_PRODUCTS,
  PACKAGE_RELATIVE_PATH,
} = require("./wire-local-package.js");

// Wires the local SwiftPM package at projects/react-native-watchos/swift into
// the @bacons/apple-targets–generated watch + widget targets. The pbxproj-
// editing logic lives in ./wire-local-package.js (dependency-free, shared with
// the post-prebuild scripts/link-swift-package.cjs).
//
// IMPORTANT: apple-targets injects the watch/widget native targets through its
// own custom base mod, which writes the pbxproj at a point we can't reliably
// order this withXcodeProject mod after. So at this mod's runtime the targets
// usually don't exist yet and only the package *reference* lands here; the
// product *links* are applied authoritatively after prebuild by
// scripts/link-swift-package.cjs (idempotent — reuses the same wireLocalPackage).
// This mod is wrapped so it can never fail `expo prebuild`.

const withReactWatchPackage = (config) => {
  return withXcodeProject(config, (cfg) => {
    try {
      wireLocalPackage(cfg.modResults, {
        packagePath: PACKAGE_RELATIVE_PATH,
        targetProducts: TARGET_PRODUCTS,
      });
    } catch (error) {
      console.warn(
        "[react-watch] could not pre-register the SwiftPM package; the " +
          "post-prebuild link step (npm run link-swift-package) will still " +
          "wire it. " +
          String(error),
      );
    }
    return cfg;
  });
};

// createRunOncePlugin tags the plugin by name+version so repeated prebuilds /
// duplicate plugin entries apply it once (the Expo library convention). The
// pbxproj edit is also idempotent on its own.
const plugin = createRunOncePlugin(
  withReactWatchPackage,
  "react-native-watchos-swiftpm",
  "0.1.0",
);

plugin.wireLocalPackage = wireLocalPackage;
plugin.TARGET_PRODUCTS = TARGET_PRODUCTS;
plugin.PACKAGE_RELATIVE_PATH = PACKAGE_RELATIVE_PATH;
module.exports = plugin;
