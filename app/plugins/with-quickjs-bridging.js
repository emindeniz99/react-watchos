const { withXcodeProject } = require("@expo/config-plugins");

// @bacons/apple-targets generates the watch + widget targets but exposes no
// way to set arbitrary build settings, so this plugin sets the QuickJS
// Objective-C bridging header (and header search path) on those targets so
// Swift can call the vendored C engine. Without it the build fails with
// "cannot find 'JS_NewRuntime' in scope". Runs during `expo prebuild`.
//
// NOTE: unverified here (no Xcode/prebuild on Linux). If target matching or
// the relative path is off, set SWIFT_OBJC_BRIDGING_HEADER manually in
// Xcode — see the README's first-build friction list.
const BRIDGED_TARGETS = {
  "React Watch": "targets/watch/Vendor/quickjs",
  "React Watch Widgets": "targets/widget/Vendor/quickjs",
};

module.exports = function withQuickJSBridging(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const configurations = project.pbxXCBuildConfigurationSection();

    for (const key of Object.keys(configurations)) {
      const entry = configurations[key];
      const settings = entry && entry.buildSettings;
      if (!settings) continue;
      const productName = (settings.PRODUCT_NAME || "").replace(/"/g, "");
      const vendor = BRIDGED_TARGETS[productName];
      if (!vendor) continue;

      // Path is relative to the generated `ios/` project dir; the target
      // sources live alongside it under the project root's targets/.
      settings.SWIFT_OBJC_BRIDGING_HEADER = `"$(PROJECT_DIR)/../${vendor}/quickjs-swift-shim.h"`;
      const search = `"$(PROJECT_DIR)/../${vendor}"`;
      const existing = settings.HEADER_SEARCH_PATHS;
      if (Array.isArray(existing)) {
        if (!existing.includes(search)) existing.push(search);
      } else if (existing && existing !== '"$(inherited)"') {
        settings.HEADER_SEARCH_PATHS = ['"$(inherited)"', existing, search];
      } else {
        settings.HEADER_SEARCH_PATHS = ['"$(inherited)"', search];
      }
    }
    return cfg;
  });
};
