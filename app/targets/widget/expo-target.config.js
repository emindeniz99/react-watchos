/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: "watch-widget",
  name: "React Watch Widgets",
  deploymentTarget: "10.0",
  bundleIdentifier: ".watch.widgets",
  // Reads the React-rendered timelines the watch app publishes. Must match
  // the watch target's entitlement and ReactWidgets.swift.
  entitlements: {
    "com.apple.security.application-groups": [
      "group.com.emindeniz99.reactwatch",
    ],
  },
});
