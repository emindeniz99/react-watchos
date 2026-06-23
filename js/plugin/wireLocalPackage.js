// Pure pbxproj-editing logic for wiring a local SwiftPM package (the
// react-native-watchos Swift host) into the @bacons/apple-targets–generated
// watch + widget targets. The default product map is:
//   • <watch app>        -> ReactWatchHost
//   • <widget extension> -> ReactWatchCore, ReactWatchSupport, ReactWatchRuntime
//
// The engine is a Clang module (CQuickJS) vended by the package, imported as
// `import CQuickJS` — no bridging header.
//
// Kept free of any `@expo/config-plugins` import so it can be required both
// from the config plugin (during prebuild) AND from a standalone post-prebuild
// node script (link-swift-package.cjs), which runs outside Expo's module
// resolution. Neither apple-targets 4.x nor node-xcode 3.x has a local-Swift-
// package API, so we write the pbxproj objects directly
// (XCLocalSwiftPackageReference + XCSwiftPackageProductDependency + PBXBuildFile
// in the Frameworks phase).

// Product targets for the package host, keyed by apple-targets target name.
// Exported as the defaults the plugin derives from its `name` option; callers
// pass the resolved map (with the consumer's watch/widget names) explicitly.
const HOST_PRODUCTS = ["ReactWatchHost"];
const WIDGET_PRODUCTS = ["ReactWatchCore", "ReactWatchSupport", "ReactWatchRuntime"];

/** Ensures an ISA section exists in the pbxproj object graph. */
function section(objects, isa) {
  if (!objects[isa]) objects[isa] = {};
  return objects[isa];
}

// node-xcode preserves the literal surrounding quotes for pbxproj values that
// contain spaces, so a target named "React Watch" parses as `"React Watch"`
// (quotes included). Strip them before comparing against a plain target name.
function unquote(value) {
  return typeof value === "string" &&
    value.length >= 2 &&
    value.startsWith('"') &&
    value.endsWith('"')
    ? value.slice(1, -1)
    : value;
}

/**
 * Adds the local package reference and links each target's products. Pure
 * over a node-xcode `XcodeProject` (uses `.hash` + `.generateUuid()`), so it
 * can be unit-smoke-tested without Xcode. Idempotent by package path /
 * (target, product).
 *
 * @param {object} project node-xcode XcodeProject
 * @param {{ packagePath: string, targetProducts: Record<string, string[]> }} opts
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
      (k) =>
        !k.endsWith("_comment") && unquote(nativeTargets[k].name) === targetName,
    );
    if (!targetUuid) continue; // target not generated (yet) — skip quietly
    const target = nativeTargets[targetUuid];
    if (!target.packageProductDependencies) {
      target.packageProductDependencies = [];
    }
    if (!target.buildPhases) target.buildPhases = [];

    // The target's Frameworks build phase — products must link there for Xcode
    // to actually build them. apple-targets gives the watch *app* target no
    // Frameworks phase at all (only Sources/Resources/Embed), so create one;
    // otherwise the product dependency is recorded but never compiled, and the
    // app fails with "no such module". (The widget target does get one.)
    let phase = target.buildPhases
      .map((p) => frameworkPhases[p.value])
      .find(Boolean);
    if (!phase) {
      const phaseUuid = project.generateUuid();
      phase = {
        isa: "PBXFrameworksBuildPhase",
        buildActionMask: 2147483647,
        files: [],
        runOnlyForDeploymentPostprocessing: 0,
      };
      frameworkPhases[phaseUuid] = phase;
      frameworkPhases[`${phaseUuid}_comment`] = "Frameworks";
      target.buildPhases.push({ value: phaseUuid, comment: "Frameworks" });
    }
    if (!phase.files) phase.files = [];

    for (const productName of products) {
      // Idempotent in two independent steps so a partially-wired project (e.g.
      // a dependency added on an earlier run but never placed in a build phase)
      // gets reconciled rather than skipped.

      // 1. The product dependency on the target.
      let depUuid = target.packageProductDependencies
        .map((d) => d.value)
        .find((v) => prodDeps[v] && prodDeps[v].productName === productName);
      if (!depUuid) {
        depUuid = project.generateUuid();
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
      }

      // 2. A build file for it in the Frameworks phase.
      const inPhase = phase.files.some((f) => {
        const bf = buildFiles[f.value];
        return bf && bf.productRef === depUuid;
      });
      if (inPhase) continue;

      const buildFileUuid = project.generateUuid();
      buildFiles[buildFileUuid] = {
        isa: "PBXBuildFile",
        productRef: depUuid,
        productRef_comment: productName,
      };
      buildFiles[`${buildFileUuid}_comment`] = `${productName} in Frameworks`;
      phase.files.push({
        value: buildFileUuid,
        comment: `${productName} in Frameworks`,
      });
      linked.push(`${targetName}:${productName}`);
    }
  }
  return { packageRef, linked };
}

module.exports = { wireLocalPackage, HOST_PRODUCTS, WIDGET_PRODUCTS };
