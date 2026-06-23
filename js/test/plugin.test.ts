import { createRequire } from "node:module";
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
} = require("../plugin/wireLocalPackage.js");
const { deepMerge } = require("../plugin/mergeInfoPlist.js");
const {
  watchTargetConfig,
  widgetTargetConfig,
} = require("../plugin/targetConfig.js");
// index.js only requires @expo/config-plugins lazily (inside the plugin fn), so
// loading the module to test its pure exports works without Expo installed.
const withReactWatch = require("../plugin/index.js");

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
  const packagePath = "../../swift";

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
    deploymentTarget: "10.0",
    scheme: "reactwatch",
    watchBundleSuffix: ".watch",
    widgetBundleSuffix: ".watch.widgets",
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
        CFBundleURLSchemes: ["reactwatch"],
      },
    ]);
    // HealthKit on => the HealthKit/motion usage strings are present.
    expect(c.infoPlist.NSHealthShareUsageDescription).toBeTruthy();
    expect(c.infoPlist.NSMotionUsageDescription).toBeTruthy();
  });

  it("omits HealthKit entitlement + usage strings when healthKit is off", () => {
    const c = watchTargetConfig({ ...demoOpts, healthKit: false });
    expect(c.entitlements["com.apple.developer.healthkit"]).toBeUndefined();
    expect(c.infoPlist.NSHealthShareUsageDescription).toBeUndefined();
    expect(c.infoPlist.NSHealthUpdateUsageDescription).toBeUndefined();
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

  it("derives the App Group + widget name from the bundle id and name", () => {
    const o = resolveOptions(config, {});
    expect(o.name).toBe("React Watch");
    expect(o.widgetName).toBe("React Watch Widgets");
    expect(o.appGroup).toBe("group.com.emindeniz99.reactwatch");
    expect(o.deploymentTarget).toBe("10.0");
    expect(o.scheme).toBe("reactwatch");
    expect(o.watchBundleSuffix).toBe(".watch");
    expect(o.widgetBundleSuffix).toBe(".watch.widgets");
    expect(o.widget).toBe(true);
    expect(o.healthKit).toBe(true);
  });

  it("respects overrides and a custom name flows to the widget name", () => {
    const o = resolveOptions(config, {
      name: "My Watch",
      appGroup: "group.custom",
      widget: false,
      healthKit: false,
    });
    expect(o.name).toBe("My Watch");
    expect(o.widgetName).toBe("My Watch Widgets");
    expect(o.appGroup).toBe("group.custom");
    expect(o.widget).toBe(false);
    expect(o.healthKit).toBe(false);
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
    const cfg = withEasAppExtensions({ ...config }, resolveOptions(config, {}));
    expect(extensionsOf(cfg)).toEqual([
      {
        targetName: "React Watch",
        bundleIdentifier: "com.emindeniz99.reactwatch.watch",
        entitlements: {
          "com.apple.security.application-groups": [
            "group.com.emindeniz99.reactwatch",
          ],
          "com.apple.developer.healthkit": true,
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
  });

  it("is idempotent — upserts by targetName instead of duplicating", () => {
    const opts = resolveOptions(config, {});
    const cfg = { ...config };
    withEasAppExtensions(cfg, opts);
    withEasAppExtensions(cfg, opts);
    expect(extensionsOf(cfg)).toHaveLength(2);
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
