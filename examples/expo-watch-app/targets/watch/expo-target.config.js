/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
// The watch target. @bacons/apple-targets generates it during `expo
// prebuild`. Standalone so the watch app runs without the phone. The Swift
// host (JSRuntime, NodeView, the vendored quickjs-ng, the generated wire
// models) is NOT auto-included — copy it from the reference app; see
// ../../README.md.
module.exports = (config) => ({
  type: "watch",
  name: "Expo Watch",
  deploymentTarget: "11.0",
  bundleIdentifier: ".watch",
  infoPlist: {
    // Standalone: the watch app runs and updates its UI without the phone.
    WKRunsIndependentlyOfCompanionApp: true,
  },
});
