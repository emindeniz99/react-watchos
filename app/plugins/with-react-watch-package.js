const { withXcodeProject, createRunOncePlugin } = require("@expo/config-plugins");

// Wires the local SwiftPM package at projects/react-native-watchos/swift into
// the @bacons/apple-targets–generated watch + widget targets:
//   • "React Watch"         -> ReactWatchHost
//   • "React Watch Widgets" -> ReactWatchCore, ReactWatchRuntime
//
// The engine is a Clang module (CQuickJS) vended by the package, imported as
// `import CQuickJS` — no bridging header.
//
// Neither apple-targets 4.x nor node-xcode 3.x has a local-Swift-package API,
// so this writes the pbxproj objects directly (XCLocalSwiftPackageReference +
// XCSwiftPackageProductDependency + PBXBuildFile in the Frameworks phase).
//
// NOTE: unverifiable on Linux (no Xcode). It's idempotent and wrapped so it
// can never fail `expo prebuild`; if the resulting project is off, remove the
// partial refs and add the package by hand: File ▸ Add Package Dependencies ▸
// Add Local… ▸ select ../swift, then link the products above.

const PACKAGE_RELATIVE_PATH = "../swift";
const TARGET_PRODUCTS = {
  "React Watch": ["ReactWatchHost"],
  "React Watch Widgets": ["ReactWatchCore", "ReactWatchRuntime"],
};

/** Ensures an ISA section exists in the pbxproj object graph. */
function section(objects, isa) {
  if (!objects[isa]) objects[isa] = {};
  return objects[isa];
}

/**
 * Adds the local package reference and links each target's products. Pure
 * over a node-xcode `XcodeProject` (uses `.hash` + `.generateUuid()`), so it
 * can be unit-smoke-tested without Xcode. Idempotent by package path /
 * (target, product).
 *
 * @returns {{ packageRef: string, linked: string[] }}
 */
function wireLocalPackage(project, { packagePath, targetProducts }) {
  const objects = project.hash.project.objects;
  const localRefs = section(objects, "XCLocalSwiftPackageReference");

  // 1. The local package reference (one per relativePath).
  let packageRef = Object.keys(localRefs).find(
    (k) => !k.endsWith("_comment") && localRefs[k].relativePath === packagePath,
  );
  if (!packageRef) {
    packageRef = project.generateUuid();
    localRefs[packageRef] = {
      isa: "XCLocalSwiftPackageReference",
      relativePath: packagePath,
    };
    localRefs[`${packageRef}_comment`] =
      `XCLocalSwiftPackageReference "${packagePath}"`;
  }

  // 2. Reference it from the root PBXProject.
  const { firstProject } = project.getFirstProject();
  if (!firstProject.packageReferences) firstProject.packageReferences = [];
  if (!firstProject.packageReferences.some((r) => r.value === packageRef)) {
    firstProject.packageReferences.push({
      value: packageRef,
      comment: `XCLocalSwiftPackageReference "${packagePath}"`,
    });
  }

  const nativeTargets = section(objects, "PBXNativeTarget");
  const prodDeps = section(objects, "XCSwiftPackageProductDependency");
  const buildFiles = section(objects, "PBXBuildFile");
  const frameworkPhases = section(objects, "PBXFrameworksBuildPhase");
  const linked = [];

  for (const [targetName, products] of Object.entries(targetProducts)) {
    const targetUuid = Object.keys(nativeTargets).find(
      (k) => !k.endsWith("_comment") && nativeTargets[k].name === targetName,
    );
    if (!targetUuid) continue; // target not generated (yet) — skip quietly
    const target = nativeTargets[targetUuid];
    if (!target.packageProductDependencies) {
      target.packageProductDependencies = [];
    }
    // The target's Frameworks build phase (products link there).
    const phaseRef = (target.buildPhases || []).find(
      (p) => frameworkPhases[p.value],
    );
    const phase = phaseRef ? frameworkPhases[phaseRef.value] : undefined;

    for (const productName of products) {
      const already = target.packageProductDependencies.some((d) => {
        const dep = prodDeps[d.value];
        return dep && dep.productName === productName;
      });
      if (already) continue;

      const depUuid = project.generateUuid();
      prodDeps[depUuid] = {
        isa: "XCSwiftPackageProductDependency",
        package: packageRef,
        productName,
      };
      prodDeps[`${depUuid}_comment`] = productName;
      target.packageProductDependencies.push({
        value: depUuid,
        comment: productName,
      });

      const buildFileUuid = project.generateUuid();
      buildFiles[buildFileUuid] = {
        isa: "PBXBuildFile",
        productRef: depUuid,
        productRef_comment: productName,
      };
      buildFiles[`${buildFileUuid}_comment`] =
        `${productName} in Frameworks`;
      if (phase) {
        if (!phase.files) phase.files = [];
        phase.files.push({
          value: buildFileUuid,
          comment: `${productName} in Frameworks`,
        });
      }
      linked.push(`${targetName}:${productName}`);
    }
  }
  return { packageRef, linked };
}

const withReactWatchPackage = (config) => {
  return withXcodeProject(config, (cfg) => {
    try {
      const { linked } = wireLocalPackage(cfg.modResults, {
        packagePath: PACKAGE_RELATIVE_PATH,
        targetProducts: TARGET_PRODUCTS,
      });
      if (linked.length) {
        console.log(`[react-watch] linked SwiftPM products: ${linked.join(", ")}`);
      }
    } catch (error) {
      console.warn(
        "[react-watch] could not auto-link the SwiftPM package; add it in " +
          "Xcode (File ▸ Add Package Dependencies ▸ Add Local ▸ ../swift). " +
          String(error),
      );
    }
    return cfg;
  });
};

// createRunOncePlugin tags the plugin by name+version so repeated prebuilds /
// duplicate plugin entries apply it once (the Expo library convention). The
// pbxproj edit is also idempotent on its own.
const plugin = createRunOncePlugin(
  withReactWatchPackage,
  "react-native-watchos-swiftpm",
  "0.1.0",
);

plugin.wireLocalPackage = wireLocalPackage;
plugin.TARGET_PRODUCTS = TARGET_PRODUCTS;
plugin.PACKAGE_RELATIVE_PATH = PACKAGE_RELATIVE_PATH;
module.exports = plugin;
