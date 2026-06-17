/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: "watch",
  name: "React Watch",
  deploymentTarget: "10.0",
  bundleIdentifier: ".watch",
  // Shares React-rendered widget timelines with targets/widget. Must match
  // SharedWidgetStore.appGroupId.
  entitlements: {
    "com.apple.security.application-groups": [
      "group.com.emindeniz99.reactwatch",
    ],
    // Live heart rate via a HealthKit workout (SensorBridge).
    "com.apple.developer.healthkit": true,
  },
  // Standalone: the watch app runs (and updates its UI) without the phone.
  // If a key is not applied by prebuild, set it manually in the watch
  // target's Info.plist in Xcode.
  infoPlist: {
    WKRunsIndependentlyOfCompanionApp: true,
    // Required for the CoreBluetooth central (BluetoothBridge / movie remote).
    NSBluetoothAlwaysUsageDescription:
      "Connect to a nearby device (e.g. your laptop) to control playback.",
    // SensorBridge: live heart rate (HealthKit) + motion (CoreMotion).
    NSHealthShareUsageDescription:
      "Show your live heart rate while a workout is active.",
    NSHealthUpdateUsageDescription:
      "Record a workout session to read live heart rate.",
    NSMotionUsageDescription: "Use device motion for interactive features.",
  },
});
