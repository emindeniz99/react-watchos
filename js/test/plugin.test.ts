import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The config-plugin's pure logic is CommonJS (the `app.plugin.js` Expo
// convention + the post-prebuild scripts `require()` it synchronously), so load
// it through createRequire from these ESM tests. This is the logic that was
// UNTESTED while it lived in app/plugins + app/scripts; moving it into the
// package made it unit-testable (publishing.md Phase 1).
const require = createRequire(import.meta.url);
const {
  wireLocalPackage,
  HOST_PRODUCTS,
  WIDGET_PRODUCTS,
} = require("../plugin/wireLocalPackage.cts");
const { deepMerge } = require("../plugin/mergeInfoPlist.cts");
const {
  watchTargetConfig,
  widgetTargetConfig,
} = require("../plugin/targetConfig.cts");
// index.js only requires @expo/config-plugins lazily (inside the plugin fn), so
// loading the module to test its pure exports works without Expo installed.
const withReactWatch = require("../plugin/index.cts");
const { mergeTargetInfoPlists } = require("../plugin/withNativeWiring.cts");

// ---------------------------------------------------------------------------
// Minimal fake node-xcode XcodeProject: just the surface wireLocalPackage uses
// (`.hash.project.objects`, `.generateUuid()`, `.getFirstProject()`). Lets us
// assert the pbxproj object graph it writes without Xcode / node-xcode.
// ---------------------------------------------------------------------------
function fakeProject({ withFrameworksPhase = true } = {}) {
  let counter = 0;
  const objects: Record<string, Record<string, unknown>> = {
    PBXNativeTarget: {},
    PBXFrameworksBuildPhase: {},
  };

  // A watch app target. apple-targets gives the *app* target NO Frameworks
  // phase (only Sources/Resources/Embed) — model both so we can prove the code
  // creates one when absent. The widget target normally has one.
  const watchUuid = "WATCH0001";
  const target: Record<string, unknown> = {
    isa: "PBXNativeTarget",
    name: '"React Watch"', // node-xcode keeps the surrounding quotes for names
    buildPhases: [],
  };
  objects.PBXNativeTarget[watchUuid] = target;
  objects.PBXNativeTarget[`${watchUuid}_comment`] = "React Watch";

  if (withFrameworksPhase) {
    const phaseUuid = "PHASE0001";
    (objects.PBXFrameworksBuildPhase as Record<string, unknown>)[phaseUuid] = {
      isa: "PBXFrameworksBuildPhase",
      files: [],
    };
    (target.buildPhases as Array<{ value: string; comment: string }>).push({
      value: phaseUuid,
      comment: "Frameworks",
    });
  }

  const project = {
    hash: { project: { objects } },
    generateUuid() {
      counter += 1;
      return `UUID_${String(counter).padStart(4, "0")}`;
    },
    getFirstProject() {
      return { firstProject: project._firstProject };
    },
    _firstProject: {} as { packageReferences?: Array<{ value: string }> },
  };
  return project;
}

function countBy(
  objects: Record<string, Record<string, unknown>>,
  isa: string,
) {
  return Object.keys(objects[isa] ?? {}).filter((k) => !k.endsWith("_comment"))
    .length;
}

describe("wireLocalPackage (pbxproj wiring)", () => {
  const packagePath = "../../js/swift";

  it("links the host product into the watch target and reports it", () => {
    const project = fakeProject();
    const { packageRef, linked } = wireLocalPackage(project, {
      packagePath,
      targetProducts: { "React Watch": HOST_PRODUCTS },
    });

    expect(linked).toEqual(["React Watch:ReactWatchHost"]);
    const objects = project.hash.project.objects;

    // The local package reference exists and is referenced from the root.
    const ref = objects.XCLocalSwiftPackageReference[packageRef] as {
      relativePath: string;
    };
    expect(ref.relativePath).toBe(packagePath);
    expect(project._firstProject.packageReferences).toContainEqual(
      expect.objectContaining({ value: packageRef }),
    );

    // A product dependency + a build file in the Frameworks phase.
    expect(countBy(objects, "XCSwiftPackageProductDependency")).toBe(1);
    expect(countBy(objects, "PBXBuildFile")).toBe(1);
  });

  // A REGISTRY install realpaths into pnpm's store dir, whose "@"/"+" are
  // outside the pbxproj unquoted-safe charset — written bare they corrupt the
  // project and CocoaPods dies parsing it ("Dictionary missing ';' after
  // key-value pair for \"relativePath\"", found by the FlareLog consumer).
  // node-xcode writes values literally, so the plugin must self-quote; and a
  // rerun must still dedupe against the quoted stored form.
  it("quotes a pnpm-store package path and stays idempotent over it", () => {
    const pnpmPath =
      "../../node_modules/.pnpm/react-watchos@0.1.0_@babel+core@8.0.1/node_modules/react-watchos/swift";
    const project = fakeProject();
    const { packageRef } = wireLocalPackage(project, {
      packagePath: pnpmPath,
      targetProducts: { "React Watch": HOST_PRODUCTS },
    });
    const objects = project.hash.project.objects;
    expect(
      (
        objects.XCLocalSwiftPackageReference[packageRef] as {
          relativePath: string;
        }
      ).relativePath,
    ).toBe(`"${pnpmPath}"`);
    // Second run dedupes against the stored (quoted) form — no duplicate ref.
    const again = wireLocalPackage(project, {
      packagePath: pnpmPath,
      targetProducts: { "React Watch": HOST_PRODUCTS },
    });
    expect(again.packageRef).toBe(packageRef);
    // The clean-path case stays bare so existing demo projects don't churn.
    const clean = fakeProject();
    const cleanRef = wireLocalPackage(clean, {
      packagePath: "../../js/swift",
      targetProducts: { "React Watch": HOST_PRODUCTS },
    }).packageRef;
    expect(
      (
        clean.hash.project.objects.XCLocalSwiftPackageReference[cleanRef] as {
          relativePath: string;
        }
      ).relativePath,
    ).toBe("../../js/swift");
  });

  it("creates a Frameworks build phase when the target has none", () => {
    // The watch app target has no Frameworks phase — the link must still land,
    // otherwise the product is recorded but never compiled ("no such module").
    const project = fakeProject({ withFrameworksPhase: false });
    const { linked } = wireLocalPackage(project, {
      packagePath,
      targetProducts: { "React Watch": HOST_PRODUCTS },
    });

    expect(linked).toEqual(["React Watch:ReactWatchHost"]);
    const phases = project.hash.project.objects.PBXFrameworksBuildPhase;
    expect(
      countBy(project.hash.project.objects, "PBXFrameworksBuildPhase"),
    ).toBe(1);
    const phase = Object.entries(phases).find(
      ([k]) => !k.endsWith("_comment"),
    )?.[1] as { files: unknown[] };
    expect(phase.files).toHaveLength(1);
  });

  it("is idempotent: a second run links nothing and adds no objects", () => {
    const project = fakeProject();
    const targetProducts = { "React Watch": HOST_PRODUCTS };
    wireLocalPackage(project, { packagePath, targetProducts });
    const objects = project.hash.project.objects;
    const before = {
      refs: countBy(objects, "XCLocalSwiftPackageReference"),
      deps: countBy(objects, "XCSwiftPackageProductDependency"),
      files: countBy(objects, "PBXBuildFile"),
    };

    const { linked } = wireLocalPackage(project, {
      packagePath,
      targetProducts,
    });

    expect(linked).toEqual([]);
    expect({
      refs: countBy(objects, "XCLocalSwiftPackageReference"),
      deps: countBy(objects, "XCSwiftPackageProductDependency"),
      files: countBy(objects, "PBXBuildFile"),
    }).toEqual(before);
    // The root package reference must not be duplicated either.
    expect(project._firstProject.packageReferences).toHaveLength(1);
  });

  it("reconciles a half-wired project (dep present, never placed in a phase)", () => {
    // Models a project from an earlier run that recorded the product dependency
    // but never added the build file (e.g. interrupted). The two idempotency
    // checks are independent, so the build file must still get added.
    const project = fakeProject();
    const objects = project.hash.project.objects;
    wireLocalPackage(project, {
      packagePath,
      targetProducts: { "React Watch": HOST_PRODUCTS },
    });
    // Drop the build file + its phase entry, keep the product dependency.
    const phase = Object.entries(objects.PBXFrameworksBuildPhase).find(
      ([k]) => !k.endsWith("_comment"),
    )?.[1] as { files: Array<{ value: string }> };
    const removed = phase.files.pop();
    if (removed) {
      delete objects.PBXBuildFile[removed.value];
      delete objects.PBXBuildFile[`${removed.value}_comment`];
    }
    expect(countBy(objects, "PBXBuildFile")).toBe(0);

    const { linked } = wireLocalPackage(project, {
      packagePath,
      targetProducts: { "React Watch": HOST_PRODUCTS },
    });

    expect(linked).toEqual(["React Watch:ReactWatchHost"]);
    // Reused the existing dependency, only added the missing build file.
    expect(countBy(objects, "XCSwiftPackageProductDependency")).toBe(1);
    expect(countBy(objects, "PBXBuildFile")).toBe(1);
  });

  it("skips targets that don't exist yet (apple-targets base-mod ordering)", () => {
    // During prebuild the widget target often isn't created when this runs, so
    // an unknown target name must be skipped quietly (not throw) — that's why
    // the authoritative links are re-applied post-prebuild.
    const project = fakeProject();
    const { linked } = wireLocalPackage(project, {
      packagePath,
      targetProducts: {
        "React Watch": HOST_PRODUCTS,
        "React Watch Widgets": WIDGET_PRODUCTS, // not in the fake project
      },
    });
    expect(linked).toEqual(["React Watch:ReactWatchHost"]);
  });
});

describe("deepMerge (Info.plist merge semantics)", () => {
  it("recursively merges nested plain objects", () => {
    const target = { a: { x: 1, y: 2 }, top: "keep" };
    const source = { a: { y: 3, z: 4 } };
    expect(deepMerge(target, source)).toEqual({
      a: { x: 1, y: 3, z: 4 },
      top: "keep",
    });
  });

  it("replaces arrays wholesale rather than concatenating", () => {
    // CFBundleURLTypes is an array; a config value must overwrite, not append
    // (otherwise repeated merges would grow the array).
    const target = { CFBundleURLTypes: [{ a: 1 }] };
    const source = { CFBundleURLTypes: [{ b: 2 }] };
    expect(deepMerge(target, source)).toEqual({
      CFBundleURLTypes: [{ b: 2 }],
    });
  });

  it("does not mutate its inputs", () => {
    const target = { a: { x: 1 } };
    const source = { a: { y: 2 } };
    const targetSnapshot = structuredClone(target);
    deepMerge(target, source);
    expect(target).toEqual(targetSnapshot);
  });

  it("returns the source when either side is not a plain object", () => {
    expect(deepMerge(1, { a: 1 })).toEqual({ a: 1 });
    expect(deepMerge({ a: 1 }, 2)).toBe(2);
  });
});

describe("targetConfig (options -> apple-targets config)", () => {
  // Defaults that reproduce the demo's two hand-authored expo-target.config.js.
  const demoOpts = {
    name: "React Watch",
    widgetName: "React Watch Widgets",
    appGroup: "group.com.emindeniz99.reactwatch",
    widget: true,
    healthKit: true,
    workouts: false,
    motion: false,
    calendar: false,
    deploymentTarget: "10.0",
    scheme: "com.emindeniz99.reactwatch",
    watchBundleSuffix: ".watch",
    widgetBundleSuffix: ".watch.widgets",
    independent: true,
    bundleIdentifier: "com.emindeniz99.reactwatch",
    infoPlist: {},
  };

  it("watch config matches the demo's values", () => {
    const c = watchTargetConfig(demoOpts);
    expect(c.type).toBe("watch");
    expect(c.name).toBe("React Watch");
    expect(c.deploymentTarget).toBe("10.0");
    expect(c.bundleIdentifier).toBe(".watch");
    expect(c.entitlements["com.apple.security.application-groups"]).toEqual([
      "group.com.emindeniz99.reactwatch",
    ]);
    expect(c.entitlements["com.apple.developer.healthkit"]).toBe(true);
    expect(c.infoPlist.WKRunsIndependentlyOfCompanionApp).toBe(true);
    expect(c.infoPlist.CFBundleURLTypes).toEqual([
      {
        CFBundleURLName: "com.emindeniz99.reactwatch.routes",
        CFBundleURLSchemes: ["com.emindeniz99.reactwatch"],
      },
    ]);
    // HealthKit on => the HealthKit usage strings are present.
    expect(c.infoPlist.NSHealthShareUsageDescription).toBeTruthy();
  });

  it("emits NSMotionUsageDescription from `motion`, NOT from healthKit", () => {
    // It used to ride `healthKit`, which is wrong twice over: CoreMotion needs
    // the key with no HealthKit involved (the motion/gyroscope streams and
    // CMPedometer), and an app wanting step counts had to take the HealthKit
    // entitlement to get it. Apple documents that calling CMPedometer without
    // the key CRASHES, so the runtime guard in PedometerBridge is what makes
    // the false default safe.
    expect(
      watchTargetConfig({ ...demoOpts, healthKit: true, motion: false })
        .infoPlist.NSMotionUsageDescription,
    ).toBeUndefined();
    expect(
      watchTargetConfig({ ...demoOpts, healthKit: false, motion: true })
        .infoPlist.NSMotionUsageDescription,
    ).toBeTruthy();
  });

  it("emits BOTH EventKit full-access strings from `calendar`, and no entitlement", () => {
    const on = watchTargetConfig({ ...demoOpts, calendar: true });
    expect(on.infoPlist.NSCalendarsFullAccessUsageDescription).toBeTruthy();
    expect(on.infoPlist.NSRemindersFullAccessUsageDescription).toBeTruthy();
    // The DEPRECATED spelling (deprecated at watchOS 10.0 — this package's
    // floor) must never ship: it would be an unused key App Review reads as a
    // permission the app doesn't actually use.
    expect(on.infoPlist.NSCalendarsUsageDescription).toBeUndefined();
    // watchOS gates EventKit purely through the runtime prompt. The
    // `com.apple.security.personal-information.calendars` entitlement Apple
    // documents is for SANDBOXED macOS apps, and shipping it here would break
    // provisioning for no gain.
    expect(
      on.entitlements["com.apple.security.personal-information.calendars"],
    ).toBeUndefined();
    // A consumer's own string still wins (the `??` idiom every block uses).
    expect(
      watchTargetConfig({
        ...demoOpts,
        calendar: true,
        infoPlist: { NSCalendarsFullAccessUsageDescription: "mine" },
      }).infoPlist.NSCalendarsFullAccessUsageDescription,
    ).toBe("mine");
  });

  it("omits the EventKit usage strings when calendar is off (the default)", () => {
    // M13 least privilege: an unused usage string is an App Review flag, and
    // `calendar` is off unless asked for — the healthKit/push/motion shape.
    const c = watchTargetConfig({ ...demoOpts, calendar: false });
    expect(c.infoPlist.NSCalendarsFullAccessUsageDescription).toBeUndefined();
    expect(c.infoPlist.NSRemindersFullAccessUsageDescription).toBeUndefined();
  });

  it("omits HealthKit entitlement + usage strings when healthKit is off", () => {
    const c = watchTargetConfig({ ...demoOpts, healthKit: false });
    expect(c.entitlements["com.apple.developer.healthkit"]).toBeUndefined();
    expect(c.infoPlist.NSHealthShareUsageDescription).toBeUndefined();
    expect(c.infoPlist.NSHealthUpdateUsageDescription).toBeUndefined();
  });

  it("workouts emits the workout-processing background mode", () => {
    // THE BUG THIS CLOSES: keepAliveInBackground has been documented since the
    // sensors API shipped and the plugin emitted no WKBackgroundModes at all,
    // so it was structurally unbacked — Apple requires the Workout processing
    // background mode for a session to run while the app is backgrounded.
    const on = watchTargetConfig({ ...demoOpts, workouts: true });
    expect(on.infoPlist.WKBackgroundModes).toEqual(["workout-processing"]);
    // Saving an HKWorkout needs the HealthKit entitlement, so `workouts` turns
    // it on by itself — a consumer must not have to know that pairing.
    expect(
      watchTargetConfig({ ...demoOpts, healthKit: false, workouts: true })
        .entitlements["com.apple.developer.healthkit"],
    ).toBe(true);
    // Route recording reads location.
    expect(on.infoPlist.NSLocationWhenInUseUsageDescription).toBeTruthy();
    expect(on.infoPlist.NSHealthUpdateUsageDescription).toBeTruthy();
  });

  it("healthKit's broad read string survives workouts being on too", () => {
    // Both blocks write NSHealthShareUsageDescription, and `workouts` runs
    // first — so its `??` used to pre-fill the key and make the healthKit
    // block's fallback a no-op. A fitness app (reads sleep + steps via
    // health.ts, saves workouts) then shipped the heart-rate-only sheet: the
    // exact "sheet says heart rate while the app asks for sleep history"
    // mismatch the healthKit default was reworded to remove.
    const both = watchTargetConfig({
      ...demoOpts,
      healthKit: true,
      workouts: true,
    });
    expect(both.infoPlist.NSHealthShareUsageDescription).toContain("sleep");
    // The same mismatch, one category over: SpO2 has been readable since the
    // sheet was first reworded and no word in it covered blood oxygen. Pinned
    // because the drift is silent — the sheet renders fine while under-asking.
    expect(both.infoPlist.NSHealthShareUsageDescription).toContain(
      "blood oxygen",
    );
    // The 2026-08-20 widening repeated the shape a third time: seven more
    // quantity types, four of them categories no word in the sheet implied.
    // Every one that isn't covered by a neighbouring phrase is pinned, because
    // the failure is always the same silent under-promise. The words are plain
    // English, and Apple's own label where that is already plain — so
    // `respiratoryRate` is "respiratory rate" (what the sheet's own row says),
    // while `vo2Max` becomes "cardio fitness" and `basalEnergyBurned` is named
    // rather than left to a bare "energy".
    // `queryWorkoutHistory` (same day) reads SAVED WORKOUTS —
    // `HKObjectType.workoutType()`, not a quantity type, and its own row in the
    // sheet. Recording a workout is what the UPDATE string covers; nothing in
    // the read sentence implied being shown the user's whole workout history.
    for (const category of [
      "respiratory rate",
      "cardio fitness",
      "flights climbed",
      "active and resting energy",
      "exercise and stand time",
      "your saved workouts",
    ]) {
      expect(both.infoPlist.NSHealthShareUsageDescription).toContain(category);
    }
    // Workouts alone genuinely IS heart-rate-only — don't over-promise there.
    expect(
      watchTargetConfig({ ...demoOpts, healthKit: false, workouts: true })
        .infoPlist.NSHealthShareUsageDescription,
    ).toBe("Read your heart rate while a workout is active.");
    // The workout write string still wins over healthKit's, and a consumer
    // override still beats both.
    expect(both.infoPlist.NSHealthUpdateUsageDescription).toBe(
      "Save your workouts to Health.",
    );
    expect(
      watchTargetConfig({
        ...demoOpts,
        healthKit: true,
        workouts: true,
        infoPlist: { NSHealthShareUsageDescription: "Mine." },
      }).infoPlist.NSHealthShareUsageDescription,
    ).toBe("Mine.");
  });

  it("omits the background mode when workouts is off", () => {
    // Least privilege: background execution is a capability an app that never
    // starts a workout must not carry.
    const off = watchTargetConfig(demoOpts);
    expect(off.infoPlist.WKBackgroundModes).toBeUndefined();
    expect(off.infoPlist.NSLocationWhenInUseUsageDescription).toBeUndefined();
  });

  it("lets a consumer's own WKBackgroundModes win", () => {
    // Apple allows one extended-runtime mode AND workout-processing together,
    // so a consumer that already declared a self-care session must keep it —
    // clobbering the key would silently drop their session type.
    const c = watchTargetConfig({
      ...demoOpts,
      workouts: true,
      infoPlist: { WKBackgroundModes: ["self-care", "workout-processing"] },
    });
    expect(c.infoPlist.WKBackgroundModes).toEqual([
      "self-care",
      "workout-processing",
    ]);
  });

  it("push adds the aps-environment entitlement; off omits it", () => {
    // Xcode rewrites "development" to "production" from the provisioning
    // profile at archive time, so the plugin only ever writes the dev value.
    const on = watchTargetConfig({ ...demoOpts, push: true });
    expect(on.entitlements["aps-environment"]).toBe("development");
    const off = watchTargetConfig(demoOpts);
    expect(off.entitlements["aps-environment"]).toBeUndefined();
  });

  it("derives the deep-link CFBundleURLName from a custom bundle id + scheme", () => {
    const c = watchTargetConfig({
      ...demoOpts,
      bundleIdentifier: "com.acme.app",
      scheme: "acmewatch",
    });
    expect(c.infoPlist.CFBundleURLTypes).toEqual([
      {
        CFBundleURLName: "com.acme.app.routes",
        CFBundleURLSchemes: ["acmewatch"],
      },
    ]);
  });

  it("lets caller-supplied infoPlist override the defaults", () => {
    const c = watchTargetConfig({
      ...demoOpts,
      infoPlist: { WKRunsIndependentlyOfCompanionApp: false, Custom: "x" },
    });
    expect(c.infoPlist.WKRunsIndependentlyOfCompanionApp).toBe(false);
    expect(c.infoPlist.Custom).toBe("x");
  });

  it("omits WKRunsIndependentlyOfCompanionApp for a companion-dependent watch app", () => {
    // independent: false => the key is absent (Apple's absent == dependent), so
    // the plugin never silently makes the irreversible standalone choice.
    const c = watchTargetConfig({ ...demoOpts, independent: false });
    expect("WKRunsIndependentlyOfCompanionApp" in c.infoPlist).toBe(false);
  });

  it("widget config matches the demo's values", () => {
    const c = widgetTargetConfig(demoOpts);
    expect(c).toEqual({
      type: "watch-widget",
      name: "React Watch Widgets",
      deploymentTarget: "10.0",
      bundleIdentifier: ".watch.widgets",
      entitlements: {
        "com.apple.security.application-groups": [
          "group.com.emindeniz99.reactwatch",
        ],
      },
    });
  });
});

describe("resolveOptions (defaults reproduce the demo)", () => {
  const { resolveOptions, targetProductsFor } = withReactWatch;
  const config = { ios: { bundleIdentifier: "com.emindeniz99.reactwatch" } };

  // apple-targets matches Xcode targets by productName (falling back to the
  // FIRST target of the same product type), so a watch target named exactly
  // like the app makes prebuild convert the iOS APP target into the watch app
  // and crash deep in with-xcode-changes — found by the first registry
  // consumer (FlareLog: app and watch target both "FlareLog"). Refuse early.
  it("rejects a watch target named exactly like the app", () => {
    expect(() =>
      resolveOptions({ ...config, name: "FlareLog" }, { name: "FlareLog" }),
    ).toThrow(/distinct/);
    expect(
      resolveOptions(
        { ...config, name: "FlareLog" },
        { name: "FlareLog Watch" },
      ).name,
    ).toBe("FlareLog Watch");
  });

  it("derives the App Group + widget name from the bundle id and name", () => {
    const o = resolveOptions(config, {});
    expect(o.name).toBe("React Watch");
    expect(o.widgetName).toBe("React Watch Widgets");
    expect(o.appGroup).toBe("group.com.emindeniz99.reactwatch");
    expect(o.deploymentTarget).toBe("10.0");
    // Scheme defaults to the bundle id (collision-safe across apps); the native
    // host surfaces it to JS, so there's no second place to configure it.
    expect(o.scheme).toBe("com.emindeniz99.reactwatch");
    expect(o.watchBundleSuffix).toBe(".watch");
    expect(o.widgetBundleSuffix).toBe(".watch.widgets");
    expect(o.widget).toBe(true);
    // Least privilege (M13): the sensitive HealthKit entitlement is opt-IN —
    // a default-true grant broke provisioning on App IDs without the
    // capability and invited App Review scrutiny for an unused entitlement.
    expect(o.healthKit).toBe(false);
    // Same least-privilege rule: aps-environment breaks provisioning on App
    // IDs without the Push Notifications capability, so it's opt-in too.
    expect(o.push).toBe(false);
    expect(o.independent).toBe(true); // standalone-first default
  });

  it("healthKit is an explicit opt-in", () => {
    const o = resolveOptions(config, { healthKit: true });
    expect(o.healthKit).toBe(true);
  });

  it("motion is an explicit opt-in", () => {
    expect(resolveOptions(config, {}).motion).toBe(false);
    expect(resolveOptions(config, { motion: true }).motion).toBe(true);
  });

  it("workouts is an explicit opt-in", () => {
    expect(resolveOptions(config, {}).workouts).toBe(false);
    const o = resolveOptions(config, { workouts: true });
    expect(o.workouts).toBe(true);
    expect(watchTargetConfig(o).infoPlist.WKBackgroundModes).toEqual([
      "workout-processing",
    ]);
  });

  it("push is an explicit opt-in", () => {
    const o = resolveOptions(config, { push: true });
    expect(o.push).toBe(true);
    expect(watchTargetConfig(o).entitlements["aps-environment"]).toBe(
      "development",
    );
  });

  it("scheme is overridable for a shorter custom scheme", () => {
    const o = resolveOptions(config, { scheme: "myapp" });
    expect(o.scheme).toBe("myapp");
    expect(watchTargetConfig(o).infoPlist.CFBundleURLTypes).toEqual([
      {
        CFBundleURLName: "com.emindeniz99.reactwatch.routes",
        CFBundleURLSchemes: ["myapp"],
      },
    ]);
  });

  it("respects overrides and a custom name flows to the widget name", () => {
    const o = resolveOptions(config, {
      name: "My Watch",
      appGroup: "group.custom",
      widget: false,
      healthKit: false,
      independent: false,
    });
    expect(o.name).toBe("My Watch");
    expect(o.widgetName).toBe("My Watch Widgets");
    expect(o.appGroup).toBe("group.custom");
    expect(o.widget).toBe(false);
    expect(o.healthKit).toBe(false);
    expect(o.independent).toBe(false);
  });

  it("throws a clear error when ios.bundleIdentifier is missing", () => {
    expect(() => resolveOptions({ ios: {} }, {})).toThrow(/bundleIdentifier/);
  });

  it("maps targets to the right SwiftPM products, dropping the widget when off", () => {
    expect(targetProductsFor(resolveOptions(config, {}))).toEqual({
      "React Watch": HOST_PRODUCTS,
      "React Watch Widgets": WIDGET_PRODUCTS,
    });
    expect(
      targetProductsFor(resolveOptions(config, { widget: false })),
    ).toEqual({ "React Watch": HOST_PRODUCTS });
  });
});

describe("withEasAppExtensions (EAS extra-target signing)", () => {
  const { resolveOptions, withEasAppExtensions } = withReactWatch;
  const config = { ios: { bundleIdentifier: "com.emindeniz99.reactwatch" } };
  type EasExtra = {
    extra?: {
      eas?: {
        build?: { experimental?: { ios?: { appExtensions?: unknown[] } } };
      };
    };
  };
  const extensionsOf = (cfg: unknown) =>
    (cfg as EasExtra).extra?.eas?.build?.experimental?.ios?.appExtensions;

  it("declares the watch app + widget with bundle ids and entitlements", () => {
    // healthKit/push: true are the explicit opt-ins (M13 flipped the default
    // to false); this test covers the entitlement PROPAGATION into EAS.
    const cfg = withEasAppExtensions(
      { ...config },
      resolveOptions(config, { healthKit: true, push: true }),
    );
    expect(extensionsOf(cfg)).toEqual([
      {
        targetName: "React Watch",
        bundleIdentifier: "com.emindeniz99.reactwatch.watch",
        entitlements: {
          "com.apple.security.application-groups": [
            "group.com.emindeniz99.reactwatch",
          ],
          "com.apple.developer.healthkit": true,
          "aps-environment": "development",
        },
      },
      {
        targetName: "React Watch Widgets",
        bundleIdentifier: "com.emindeniz99.reactwatch.watch.widgets",
        entitlements: {
          "com.apple.security.application-groups": [
            "group.com.emindeniz99.reactwatch",
          ],
        },
      },
    ]);
  });

  it("uses a non-dot suffix verbatim, matching apple-targets' derivation", () => {
    // apple-targets appends a leading-dot suffix to the app id but uses any
    // other suffix as the whole id. The EAS entry must agree, or its bundle-id
    // upsert would push a duplicate instead of reconciling.
    const opts = resolveOptions(config, {
      watchBundleSuffix: "watch2",
      widget: false,
    });
    const list = extensionsOf(
      withEasAppExtensions({ ...config }, opts),
    ) as Array<{ bundleIdentifier: string }>;
    expect(list[0].bundleIdentifier).toBe("watch2");
  });

  it("drops the widget entry and HealthKit when those options are off", () => {
    const opts = resolveOptions(config, { widget: false, healthKit: false });
    const list = extensionsOf(
      withEasAppExtensions({ ...config }, opts),
    ) as Array<{
      targetName: string;
      entitlements: Record<string, unknown>;
    }>;
    expect(list).toHaveLength(1);
    expect(list[0].targetName).toBe("React Watch");
    expect(
      list[0].entitlements["com.apple.developer.healthkit"],
    ).toBeUndefined();
    expect(list[0].entitlements["aps-environment"]).toBeUndefined();
  });

  it("is idempotent — upserts by targetName instead of duplicating", () => {
    const opts = resolveOptions(config, {});
    const cfg = { ...config };
    withEasAppExtensions(cfg, opts);
    withEasAppExtensions(cfg, opts);
    expect(extensionsOf(cfg)).toHaveLength(2);
  });

  // CX-011: toggling widget:false on a config that previously had the widget
  // must REMOVE its EAS entry, not leave EAS provisioning a target that's gone.
  it("removes a previously-added widget entry when widget is turned off (CX-011)", () => {
    const cfg = { ...config };
    withEasAppExtensions(cfg, resolveOptions(config, { widget: true }));
    expect(extensionsOf(cfg)).toHaveLength(2);
    withEasAppExtensions(cfg, resolveOptions(config, { widget: false }));
    const list = extensionsOf(cfg) as Array<{ targetName: string }>;
    expect(list).toHaveLength(1);
    expect(list[0].targetName).toBe("React Watch");
  });

  it("preserves a pre-existing unrelated app extension", () => {
    const existing = { targetName: "notifications", bundleIdentifier: "x" };
    const cfg = {
      ...config,
      extra: {
        eas: {
          build: { experimental: { ios: { appExtensions: [existing] } } },
        },
      },
    };
    withEasAppExtensions(cfg, resolveOptions(config, {}));
    const list = extensionsOf(cfg) as unknown[];
    expect(list).toContainEqual(existing);
    expect(list).toHaveLength(3);
  });
});

describe("removeGeneratedTargetConfigFile (widget:false cleanup, CX-011)", () => {
  const { removeGeneratedTargetConfigFile, WIDGET_DIR } = withReactWatch;
  const generated =
    "// AUTO-GENERATED by react-watchos config plugin.\nmodule.exports = {};\n";

  const stage = (contents?: string) => {
    const root = mkdtempSync(join(tmpdir(), "rnw-plugin-"));
    const dir = join(root, "targets", WIDGET_DIR);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "expo-target.config.js");
    if (contents !== undefined) writeFileSync(file, contents);
    return { root, file };
  };

  it("removes a generated widget config (marker present)", () => {
    const { root, file } = stage(generated);
    expect(removeGeneratedTargetConfigFile(root, WIDGET_DIR)).toBe(true);
    expect(existsSync(file)).toBe(false);
  });

  it("never deletes a hand-authored config (no marker)", () => {
    const { root, file } = stage(
      "module.exports = { type: 'watch-widget' };\n",
    );
    expect(removeGeneratedTargetConfigFile(root, WIDGET_DIR)).toBe(false);
    expect(existsSync(file)).toBe(true);
  });

  it("is a no-op when there's nothing to remove", () => {
    const { root } = stage(); // no file written
    expect(removeGeneratedTargetConfigFile(root, WIDGET_DIR)).toBe(false);
  });
});

// DX-3: a missing @main entry (skipped `react-watchos scaffold`) used to
// surface only as a link-time "Undefined symbols: _main" — fail loudly during
// `expo prebuild`, before apple-targets ever creates the target, instead.
describe("ensureWatchSwiftGlue (DX-3: @main entry present before prebuild)", () => {
  const { ensureWatchSwiftGlue, WATCH_DIR } = withReactWatch;

  const stage = () => {
    const root = mkdtempSync(join(tmpdir(), "rnw-swiftglue-"));
    const dir = join(root, "targets", WATCH_DIR);
    mkdirSync(dir, { recursive: true });
    return { root, dir };
  };

  it("throws naming the scaffold command when the target dir has no .swift", () => {
    const { root, dir } = stage();
    // ensureTargetConfigFile always writes expo-target.config.js first, so a
    // real prebuild's target dir is never literally empty — only missing Swift.
    writeFileSync(join(dir, "expo-target.config.js"), "module.exports = {};\n");
    expect(() => ensureWatchSwiftGlue(root, WATCH_DIR)).toThrow(
      /react-watchos scaffold/,
    );
  });

  it("throws when the target dir does not exist at all", () => {
    const root = mkdtempSync(join(tmpdir(), "rnw-swiftglue-"));
    expect(() => ensureWatchSwiftGlue(root, WATCH_DIR)).toThrow(
      /react-watchos scaffold/,
    );
  });

  it("passes once the scaffolded WatchApp.swift is present", () => {
    const { root, dir } = stage();
    writeFileSync(join(dir, "WatchApp.swift"), "@main struct App {}\n");
    expect(() => ensureWatchSwiftGlue(root, WATCH_DIR)).not.toThrow();
  });

  it("accepts any .swift file, not just WatchApp.swift", () => {
    const { root, dir } = stage();
    writeFileSync(join(dir, "MyEntry.swift"), "@main struct App {}\n");
    expect(() => ensureWatchSwiftGlue(root, WATCH_DIR)).not.toThrow();
  });
});

// CX-012: the in-prebuild Info.plist merge (the plugin runs this from its own
// xcode base mod). apple-targets writes an empty/extension plist; this merges
// the target's declared infoPlist into it, preserving existing keys.
describe("mergeTargetInfoPlists (in-prebuild plist merge)", () => {
  const emptyPlist =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
    '<plist version="1.0">\n<dict>\n<key>NSExtension</key>\n<string>keep-me</string>\n</dict>\n</plist>';

  const stage = (infoPlist: Record<string, unknown>) => {
    const root = mkdtempSync(join(tmpdir(), "rnw-plist-"));
    const dir = join(root, "targets", "watch");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "expo-target.config.js"),
      `module.exports = ${JSON.stringify({ type: "watch", name: "W", infoPlist })};\n`,
    );
    writeFileSync(join(dir, "Info.plist"), emptyPlist);
    return { root, plistPath: join(dir, "Info.plist") };
  };

  it("merges the declared infoPlist while preserving apple-targets' keys", () => {
    const { root, plistPath } = stage({
      WKRunsIndependentlyOfCompanionApp: true,
      NSBluetoothAlwaysUsageDescription: "Connect to a device.",
    });
    expect(mergeTargetInfoPlists(root)).toEqual(["watch"]);
    const written = readFileSync(plistPath, "utf8");
    expect(written).toContain("WKRunsIndependentlyOfCompanionApp");
    expect(written).toContain("NSBluetoothAlwaysUsageDescription");
    expect(written).toContain("keep-me"); // apple-targets' key survived
  });

  it("is idempotent (already-merged plist reports no change)", () => {
    const { root } = stage({ WKRunsIndependentlyOfCompanionApp: true });
    expect(mergeTargetInfoPlists(root)).toEqual(["watch"]);
    expect(mergeTargetInfoPlists(root)).toEqual([]);
  });

  it("fails loud when a target declares infoPlist but no Info.plist exists (NF-31)", () => {
    // apple-targets writes each target's Info.plist before our base mod
    // fires; a missing file means its ordering changed under us. Silently
    // skipping used to drop keys like WKRunsIndependentlyOfCompanionApp
    // from the build with no error.
    const root = mkdtempSync(join(tmpdir(), "rnw-plist-"));
    const dir = join(root, "targets", "watch");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "expo-target.config.js"),
      `module.exports = ${JSON.stringify({
        type: "watch",
        name: "W",
        infoPlist: { WKRunsIndependentlyOfCompanionApp: true },
      })};\n`,
    );
    expect(() => mergeTargetInfoPlists(root)).toThrow(/wrote no Info\.plist/);
  });

  it("stays quiet for a target with no infoPlist keys and no Info.plist", () => {
    const root = mkdtempSync(join(tmpdir(), "rnw-plist-"));
    const dir = join(root, "targets", "widget");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "expo-target.config.js"),
      'module.exports = { type: "widget", name: "W" };\n',
    );
    expect(mergeTargetInfoPlists(root)).toEqual([]);
  });
});
