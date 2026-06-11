/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: "watch",
  name: "React Watch",
  deploymentTarget: "10.0",
  bundleIdentifier: ".watch",
  // Standalone: the watch app runs (and updates its UI) without the phone.
  // If this key is not applied by prebuild, set it manually in the watch
  // target's Info.plist in Xcode.
  infoPlist: {
    WKRunsIndependentlyOfCompanionApp: true,
  },
});
