// Pure: turns the plugin's options into the @bacons/apple-targets target-config
// object(s) (the shape an `expo-target.config.js` exports). The plugin writes
// these to disk so apple-targets' `globSync` discovers them — the file contents
// are derived from options instead of hand-authored per app. Parameterizing
// these is the whole point of Phase 1: every value that was hardcoded in the
// demo's two expo-target.config.js files (target names, App Group, deployment
// target, bundle-id suffixes, HealthKit, widget families, infoPlist usage
// strings) is now an option with the demo's value as the default.
//
// Kept dependency-free so the generated config files (and these builders) can
// be unit-tested without Expo or Xcode.

/** Resolved option set with defaults applied (see plugin/index.js). */

/** The watch app's apple-targets config object. */
function watchTargetConfig(opts) {
  const entitlements = {
    "com.apple.security.application-groups": [opts.appGroup],
  };
  if (opts.healthKit) {
    // Live heart rate via a HealthKit workout (SensorBridge).
    entitlements["com.apple.developer.healthkit"] = true;
  }

  // Standalone watch app + the reactwatch:// deep-link scheme + local-network
  // OTA. HealthKit/CoreBluetooth/CoreMotion/location usage strings are only
  // included when the matching capability is requested, so a consumer who turns
  // HealthKit off doesn't ship an unused, App-Review-flagged usage string.
  const urlName = `${opts.bundleIdentifier}.routes`;
  const infoPlist = {
    WKRunsIndependentlyOfCompanionApp: true,
    CFBundleURLTypes: [
      {
        CFBundleURLName: urlName,
        CFBundleURLSchemes: [opts.scheme],
      },
    ],
    // Development OTA: allow fetching a bundle from a Mac on the LAN.
    NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
    NSLocalNetworkUsageDescription:
      "Fetch development OTA bundles from your Mac on the local network.",
    ...opts.infoPlist,
  };
  if (opts.healthKit) {
    infoPlist.NSHealthShareUsageDescription =
      infoPlist.NSHealthShareUsageDescription ??
      "Show your live heart rate while a workout is active.";
    infoPlist.NSHealthUpdateUsageDescription =
      infoPlist.NSHealthUpdateUsageDescription ??
      "Record a workout session to read live heart rate.";
    infoPlist.NSMotionUsageDescription =
      infoPlist.NSMotionUsageDescription ??
      "Use device motion for interactive features.";
  }

  return {
    type: "watch",
    name: opts.name,
    deploymentTarget: opts.deploymentTarget,
    bundleIdentifier: opts.watchBundleSuffix,
    entitlements,
    infoPlist,
  };
}

// The widget extension's apple-targets config object. `families` is a JS-side
// concept (which complication families a widget registers) and is NOT an
// apple-targets config key, so it is intentionally not emitted here.
function widgetTargetConfig(opts) {
  return {
    type: "watch-widget",
    name: opts.widgetName,
    deploymentTarget: opts.deploymentTarget,
    bundleIdentifier: opts.widgetBundleSuffix,
    entitlements: {
      "com.apple.security.application-groups": [opts.appGroup],
    },
  };
}

module.exports = { watchTargetConfig, widgetTargetConfig };
