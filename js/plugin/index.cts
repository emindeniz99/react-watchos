const fs = require("node:fs");
const path = require("node:path");
const { loadConfigPlugins, loadAppleTargets } = require("./peerDeps.cts");
const { watchTargetConfig, widgetTargetConfig } = require("./targetConfig.cts");
const { HOST_PRODUCTS, WIDGET_PRODUCTS } = require("./wireLocalPackage.cts");
const { withReactWatchNativeWiring } = require("./withNativeWiring.cts");
const { swiftPackageRelativePath } = require("./resolveSwiftPackage.cts");

const pkg = require("../package.json");

// Unified react-watchos config plugin (Phase 1 of docs/publishing.md):
// ONE parameterized, package-ready plugin that composes
//   (a) the @bacons/apple-targets watch (+ widget) target config, generated
//       from options and written to targets/<name>/expo-target.config.js,
//   (b) the SwiftPM host product linking (wireLocalPackage), and
//   (c) the Info.plist deep-merge (via the post-prebuild step, see scripts),
// replacing the demo-specific app/plugins + app/scripts + hand-authored
// expo-target.config.js files.
//
// Target-folder handling — DECISION (Phase 1, option ii):
// @bacons/apple-targets discovers targets by `globSync`-ing
// targets/<name>/expo-target.config.js at config-EVALUATION time (not in a
// mod). So this plugin writes those config files synchronously, in its own
// plugin-function body, BEFORE delegating to apple-targets. The per-target
// SWIFT GLUE (WatchApp.swift, the widget providers/intents) stays authored by
// the consumer in targets/<name>/, because which complications/widgets/intents
// exist is application-specific — generating it generically is Phase 2 ("own
// target creation"), explicitly out of scope here. The plugin owns every
// PARAMETERIZABLE part (target names, App Group, deployment target, bundle-id
// suffixes, HealthKit, infoPlist) so the consumer's targets/ holds only Swift.
//
// peerDeps note: @expo/config-plugins and @bacons/apple-targets are resolved
// from the consumer's project root (peerDeps.js), not required at the top of
// this file — under pnpm the package's own node_modules can't see the
// consumer's copies (and in this monorepo the package is symlinked to js/).

interface ReactWatchOptions {
  name?: string;
  appGroup?: string;
  widget?: boolean;
  healthKit?: boolean;
  push?: boolean;
  workouts?: boolean;
  motion?: boolean;
  deploymentTarget?: string;
  appleTeamId?: string;
  scheme?: string;
  watchBundleSuffix?: string;
  widgetBundleSuffix?: string;
  independent?: boolean;
  infoPlist?: Record<string, unknown>;
}

/**
 * Apply defaults that reproduce the demo's values exactly. The `config` param
 * is structural (just the `ios` slice it reads) so it accepts both a live
 * Expo config object and a JSON-parsed app.json (the CLI's scaffold path).
 */
function resolveOptions(
  config: { ios?: { bundleIdentifier?: string; appleTeamId?: string } },
  options: ReactWatchOptions | undefined,
): import("./targetConfig.cts").ResolvedOptions {
  const o = options || {};
  const bundleIdentifier = config.ios?.bundleIdentifier;
  if (!bundleIdentifier) {
    throw new Error(
      "[react-watchos] ios.bundleIdentifier is required in your Expo " +
        "config (it derives the App Group and the watch bundle id).",
    );
  }
  const name = o.name ?? "React Watch";
  return {
    name,
    widgetName: `${name} Widgets`,
    // App Group derived from the consumer's own bundle id (e.g. bundleId
    // "com.acme.myapp" => "group.com.acme.myapp"); overridable via `appGroup`.
    appGroup: o.appGroup ?? `group.${bundleIdentifier}`,
    widget: o.widget ?? true,
    // Least privilege (M13): a sensitive entitlement must be an explicit
    // opt-in, not a default — it breaks provisioning on App IDs without the
    // capability and draws App Review scrutiny for an unused grant. The demo
    // opts in (it exercises heart rate); the example consumer opts out.
    healthKit: o.healthKit ?? false,
    // Same least-privilege reasoning as healthKit: the aps-environment
    // entitlement breaks provisioning on App IDs without the Push
    // Notifications capability, so remote push is an explicit opt-in.
    push: o.push ?? false,
    // Same least-privilege shape (M13): `workout-processing` lets the app keep
    // running in the background, which is a capability an app that never starts
    // a workout must not carry. Turning it on also turns on the HealthKit
    // entitlement, because saving an HKWorkout needs it.
    workouts: o.workouts ?? false,
    // NSMotionUsageDescription, previously (wrongly) emitted under `healthKit`:
    // CoreMotion needs it independently of HealthKit. Default false for the
    // same least-privilege reason as the others — and safely, because
    // PedometerBridge checks the key and refuses with an actionable
    // UNAVAILABLE rather than hitting Apple's documented crash.
    motion: o.motion ?? false,
    deploymentTarget: o.deploymentTarget ?? "10.0",
    appleTeamId: o.appleTeamId ?? config.ios?.appleTeamId,
    // Deep-link scheme, defaulted to the consumer's own bundle id (like the App
    // Group) so two apps that both embed this library never register the same
    // `reactwatch://` and collide in the OS's URL routing. Reverse-DNS schemes
    // are valid + conventional (Firebase/Google do the same). The native host
    // surfaces this exact value to JS (globalThis.__urlScheme), so navigation
    // parses/builds from it with no second place to configure. Override for a
    // shorter custom scheme.
    scheme: o.scheme ?? bundleIdentifier,
    watchBundleSuffix: o.watchBundleSuffix ?? ".watch",
    widgetBundleSuffix: o.widgetBundleSuffix ?? ".watch.widgets",
    // Standalone-first (the framework's premise: the watch app runs without the
    // iPhone). Sets WKRunsIndependentlyOfCompanionApp on the watch target.
    // CAUTION: independence is IRREVERSIBLE once a build with it is uploaded to
    // the App Store — set `independent: false` for a companion-dependent watch
    // app BEFORE your first upload (see docs/publishing.md).
    independent: o.independent ?? true,
    bundleIdentifier,
    infoPlist: o.infoPlist ?? {},
  };
}

// Renders a target-config object to an `expo-target.config.js` source string.
// apple-targets `require()`s the file, so a plain `module.exports = <object>`
// is enough; JSON.stringify keeps it deterministic and quote-safe.
function renderTargetConfigFile(configObject: Record<string, unknown>) {
  return (
    "// AUTO-GENERATED by react-watchos config plugin. Do not edit.\n" +
    "// Edit the plugin options in app.json/app.config.js instead.\n" +
    `module.exports = ${JSON.stringify(configObject, null, 2)};\n`
  );
}

// Writes targets/<dir>/expo-target.config.js iff the contents would change, so
// repeated prebuilds don't churn the file (and so a consumer's hand-edits to
// their Swift glue in the same folder are untouched).
function ensureTargetConfigFile(
  projectRoot: string,
  dir: string,
  configObject: Record<string, unknown>,
) {
  const targetDir = path.join(projectRoot, "targets", dir);
  fs.mkdirSync(targetDir, { recursive: true });
  const file = path.join(targetDir, "expo-target.config.js");
  const next = renderTargetConfigFile(configObject);
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  if (current !== next) fs.writeFileSync(file, next);
}

// Removes a target's generated expo-target.config.js when the option that
// created it is turned off (CX-011), so toggling e.g. `widget:false` converges
// instead of leaving a stale target apple-targets keeps discovering. Marker-
// gated: only deletes a file we generated (the AUTO-GENERATED banner), never a
// consumer's hand-authored one, and leaves the folder's Swift glue untouched.
// Returns true if it removed a file.
function removeGeneratedTargetConfigFile(projectRoot: string, dir: string) {
  const file = path.join(projectRoot, "targets", dir, "expo-target.config.js");
  if (!fs.existsSync(file)) return false;
  if (!fs.readFileSync(file, "utf8").startsWith("// AUTO-GENERATED"))
    return false;
  fs.rmSync(file);
  return true;
}

// apple-targets keys its target directory by FOLDER name (it globs the folder,
// derives the pbxproj target from `name`). Keep the demo's folder names so
// existing Swift glue keeps working.
const WATCH_DIR = "watch";
const WIDGET_DIR = "widget";

/**
 * target-name -> SwiftPM products, derived from the resolved options.
 */
function targetProductsFor(
  opts: import("./targetConfig.cts").ResolvedOptions,
): Record<string, string[]> {
  const map: Record<string, string[]> = { [opts.name]: HOST_PRODUCTS };
  if (opts.widget) map[opts.widgetName] = WIDGET_PRODUCTS;
  return map;
}

/**
 * Declare the watch app + widget extension to EAS so cloud builds generate and
 * validate their provisioning profiles BEFORE the Xcode project exists, via
 * extra.eas.build.experimental.ios.appExtensions — the documented mechanism; a
 * config plugin that adds extension targets is expected to add this. Idempotent
 * (upsert by targetName). NOTE: not verifiable without an actual EAS build;
 * local Xcode signing is unaffected by it.
 */
function withEasAppExtensions(
  config: import("@expo/config-plugins").ExportedConfig,
  opts: import("./targetConfig.cts").ResolvedOptions,
) {
  const extra = config.extra ?? {};
  extra.eas = extra.eas ?? {};
  extra.eas.build = extra.eas.build ?? {};
  extra.eas.build.experimental = extra.eas.build.experimental ?? {};
  extra.eas.build.experimental.ios = extra.eas.build.experimental.ios ?? {};
  const ios = extra.eas.build.experimental.ios;
  ios.appExtensions = ios.appExtensions ?? [];
  config.extra = extra;

  const upsert = (entry: {
    targetName: string;
    bundleIdentifier: string;
    entitlements: Record<string, unknown>;
  }) => {
    const i = ios.appExtensions.findIndex(
      (e: { targetName?: string }) => e.targetName === entry.targetName,
    );
    if (i >= 0) ios.appExtensions[i] = entry;
    else ios.appExtensions.push(entry);
  };

  // Derive the extension bundle id the SAME way @bacons/apple-targets does
  // (with-widget.js): a leading-dot suffix is appended to the app id; any other
  // suffix is used verbatim. Unconditional concatenation would disagree with
  // apple-targets for a non-dot suffix, producing a DUPLICATE EAS appExtensions
  // entry (it upserts by bundle id) and a non-namespaced bundle id.
  const bundleIdFor = (suffix: string) =>
    String(suffix).startsWith(".")
      ? `${opts.bundleIdentifier}${suffix}`
      : String(suffix);

  upsert({
    targetName: opts.name,
    bundleIdentifier: bundleIdFor(opts.watchBundleSuffix),
    entitlements: {
      "com.apple.security.application-groups": [opts.appGroup],
      ...(opts.healthKit || opts.workouts
        ? { "com.apple.developer.healthkit": true }
        : {}),
      ...(opts.push ? { "aps-environment": "development" } : {}),
    },
  });
  if (opts.widget) {
    upsert({
      targetName: opts.widgetName,
      bundleIdentifier: bundleIdFor(opts.widgetBundleSuffix),
      entitlements: {
        "com.apple.security.application-groups": [opts.appGroup],
      },
    });
  } else {
    // Reconcile when the widget is turned off (CX-011): drop a previously-added
    // widget extension so EAS doesn't keep provisioning a target that no longer
    // exists.
    const i = ios.appExtensions.findIndex(
      (e: { targetName?: string }) => e.targetName === opts.widgetName,
    );
    if (i >= 0) ios.appExtensions.splice(i, 1);
  }
  return config;
}

const withReactWatch = (
  config: import("@expo/config-plugins").ExportedConfig,
  options: ReactWatchOptions | undefined,
) => {
  const opts = resolveOptions(config, options);
  const projectRoot = config._internal?.projectRoot ?? process.cwd();
  const { createRunOncePlugin } = loadConfigPlugins(projectRoot);
  const withAppleTargets = loadAppleTargets(projectRoot);

  // The actual plugin work, tagged run-once by name+version (duplicate plugin
  // entries / repeated prebuilds apply it once — the Expo library convention).
  // The on-disk writes and the pbxproj edit are also individually idempotent.
  const inner = createRunOncePlugin(
    ((cfg) => {
        // 0. Declare the watch app + widget extension to EAS so cloud builds
        //    provision/sign them before the Xcode project is generated.
        cfg = withEasAppExtensions(cfg, opts);

        // 1. Generate the apple-targets config file(s) on disk BEFORE
        //    apple-targets globs them (synchronously, at evaluation time).
        ensureTargetConfigFile(projectRoot, WATCH_DIR, watchTargetConfig(opts));
        if (opts.widget) {
          ensureTargetConfigFile(
            projectRoot,
            WIDGET_DIR,
            widgetTargetConfig(opts),
          );
        } else {
          // Converge when the widget is turned off (CX-011): drop the generated
          // widget target config so apple-targets stops discovering it.
          removeGeneratedTargetConfigFile(projectRoot, WIDGET_DIR);
        }

        // 2. Let apple-targets discover + inject the targets (its proven,
        //    Phase-1 target creation).
        cfg = withAppleTargets(cfg, { appleTeamId: opts.appleTeamId });

        // 3. Link the SwiftPM products + merge the target Info.plists DURING
        //    prebuild (CX-012), by hooking apple-targets' own xcode base mod and
        //    running AFTER it has created the targets — so the integration is
        //    just "add the plugin + `expo prebuild`", no postprebuild step.
        //    `relativePath` is relative to the dir CONTAINING the .xcodeproj
        //    (<projectRoot>/ios by Expo convention).
        cfg = withReactWatchNativeWiring(cfg, {
          packagePath: swiftPackageRelativePath(
            projectRoot,
            path.join(projectRoot, "ios"),
          ),
          targetProducts: targetProductsFor(opts),
        });

        return cfg;
      }) as import("@expo/config-plugins").ConfigPlugin<void>,
    pkg.name,
    pkg.version,
  );

  return inner(config);
};

// Re-exported so the post-prebuild scripts (which run outside Expo) reuse the
// package's logic instead of duplicating it.
withReactWatch.resolveOptions = resolveOptions;
withReactWatch.targetProductsFor = targetProductsFor;
withReactWatch.withEasAppExtensions = withEasAppExtensions;
withReactWatch.removeGeneratedTargetConfigFile =
  removeGeneratedTargetConfigFile;
withReactWatch.WATCH_DIR = WATCH_DIR;
withReactWatch.WIDGET_DIR = WIDGET_DIR;

module.exports = withReactWatch;
