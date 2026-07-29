// Pure: turns the plugin's options into the @bacons/apple-targets target-config
// object(s) (the shape an `expo-target.config.js` exports). The plugin writes
// these to disk so apple-targets' `globSync` discovers them — the file contents
// are derived from options instead of hand-authored per app. Parameterizing
// these is the whole point of Phase 1: every value that was hardcoded in the
// demo's two expo-target.config.js files (target names, App Group, deployment
// target, bundle-id suffixes, HealthKit, infoPlist usage
// strings) is now an option with the demo's value as the default.
//
// Kept dependency-free so the generated config files (and these builders) can
// be unit-tested without Expo or Xcode.

/**
 * Resolved option set with defaults applied (built by plugin/index.cts
 * `resolveOptions`; defined here so every module that consumes it — index,
 * these builders, the CLI scaffold — shares one shape without a cycle).
 */
export interface ResolvedOptions {
  name: string;
  widgetName: string;
  appGroup: string;
  widget: boolean;
  healthKit: boolean;
  push: boolean;
  workouts: boolean;
  motion: boolean;
  deploymentTarget: string;
  appleTeamId: string | undefined;
  scheme: string;
  watchBundleSuffix: string;
  widgetBundleSuffix: string;
  independent: boolean;
  bundleIdentifier: string;
  infoPlist: Record<string, unknown>;
}

/**
 * The watch app's apple-targets config object.
 */
function watchTargetConfig(opts: ResolvedOptions) {
  const entitlements: Record<string, unknown> = {
    "com.apple.security.application-groups": [opts.appGroup],
  };
  if (opts.healthKit || opts.workouts) {
    // The single HealthKit capability. Read/share granularity is per-type at
    // RUNTIME via requestAuthorization, not per-entitlement, so reads and the
    // workout save need this one key and nothing more
    // (`com.apple.developer.healthkit.access` is clinical records only).
    entitlements["com.apple.developer.healthkit"] = true;
  }
  if (opts.push) {
    // Remote push (APNs). "development" is the value for local/debug builds;
    // distribution signing rewrites it to "production" from the provisioning
    // profile at archive/export time, so it isn't parameterized here.
    entitlements["aps-environment"] = "development";
  }

  // Standalone watch app + the reactwatch:// deep-link scheme + local-network
  // OTA. HealthKit/CoreBluetooth/CoreMotion/location usage strings are only
  // included when the matching capability is requested, so a consumer who turns
  // HealthKit off doesn't ship an unused, App-Review-flagged usage string.
  //
  // WKRunsIndependentlyOfCompanionApp is set ONLY when `independent` (default
  // true) — for a companion-dependent watch app the key is omitted (Apple's
  // absent = dependent). It's gated behind the option, not hard-coded, because
  // independence can't be reverted after an App Store upload (see index.js).
  const urlName = `${opts.bundleIdentifier}.routes`;
  const infoPlist: Record<string, unknown> = {
    ...(opts.independent ? { WKRunsIndependentlyOfCompanionApp: true } : {}),
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
  if (opts.workouts) {
    // THE BUG THIS OPTION FIXES: `startHeartRate(cb, { keepAliveInBackground:
    // true })` has been documented since the sensors API shipped, and the
    // plugin emitted no WKBackgroundModes at all — so it was structurally
    // unbacked. Apple, "Running workout sessions": "Apps with an active workout
    // session can run in the background, so you need to add the background
    // modes capability... Workout sessions require the Workout processing
    // background mode." Without it the session ends the moment the app
    // backgrounds, whatever the JS options say.
    //
    // Composes with the extended-runtime modes rather than replacing them —
    // Apple: "you can enable both an extended runtime session mode and the
    // workout-processing mode" — so a consumer that already set
    // WKBackgroundModes keeps their value (the ?? below).
    infoPlist.WKBackgroundModes = infoPlist.WKBackgroundModes ?? [
      "workout-processing",
    ];
    // Route recording (startWorkout({ collectRoute: true })) reads location.
    // NOTE, not silently fixed (rule 3): the plugin still does not emit this
    // for the pre-existing `startLocation` stream — app/app.json supplies it
    // through the `infoPlist` escape hatch. That gap predates this option.
    infoPlist.NSLocationWhenInUseUsageDescription =
      infoPlist.NSLocationWhenInUseUsageDescription ??
      "Record the route of your workout.";
    infoPlist.NSHealthUpdateUsageDescription =
      infoPlist.NSHealthUpdateUsageDescription ??
      "Save your workouts to Health.";
    if (!opts.healthKit) {
      // Workout-only reads ARE heart-rate-only. When `healthKit` is also on the
      // block below owns this key — it must not be pre-filled here, or its `??`
      // no-ops and the sheet promises heart rate while health.ts reads sleep.
      infoPlist.NSHealthShareUsageDescription =
        infoPlist.NSHealthShareUsageDescription ??
        "Read your heart rate while a workout is active.";
    }
  }
  if (opts.healthKit) {
    // Reads are no longer heart-rate-only (js/src/health.ts adds steps, active
    // energy, distance, SpO2 and sleep), and this string is what the user is
    // shown when the permission sheet opens — a sheet that says "heart rate"
    // while the app asks for sleep history is the kind of mismatch App Review
    // and users both read as a lie. Consumer `infoPlist` overrides still win.
    infoPlist.NSHealthShareUsageDescription =
      infoPlist.NSHealthShareUsageDescription ??
      "Read your heart rate, steps, energy, distance and sleep to show " +
        "them in this app.";
    infoPlist.NSHealthUpdateUsageDescription =
      infoPlist.NSHealthUpdateUsageDescription ??
      "Record a workout session to read live heart rate.";
  }
  if (opts.motion) {
    // DECOUPLED from `healthKit` (where it used to live). CoreMotion needs this
    // key independently — the motion/gyroscope streams and CMPedometer all use
    // it, and none of them touches HealthKit — so an app that wants step counts
    // and no health history had to turn on the HealthKit entitlement to get it.
    //
    // Apple, CMPedometer: "If you don't include a usage description string,
    // your app crashes when you call this API." That is why the option can
    // safely default to false: PedometerBridge checks for the key and refuses
    // with an actionable UNAVAILABLE instead of letting the crash happen.
    infoPlist.NSMotionUsageDescription =
      infoPlist.NSMotionUsageDescription ??
      "Read your steps, distance and motion to power activity features.";
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
function widgetTargetConfig(opts: ResolvedOptions) {
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
