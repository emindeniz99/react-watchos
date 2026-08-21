// Pure pbxproj-editing logic for wiring a local SwiftPM package (the
// react-watchos Swift host) into the @bacons/apple-targets–generated
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
// ReactWatchWidget brings the WidgetKit infra (node interpreter, timeline
// providers, the extension's QuickJS runtime) and transitively links
// Core/Support/Runtime; Core is also linked directly so the consumer's
// configurable provider can name the published relevance-context type.
const WIDGET_PRODUCTS = ["ReactWatchWidget", "ReactWatchCore"];

/**
 * The slice of a node-xcode `XcodeProject` this module touches — a structural
 * type because node-xcode 3.x ships no TypeScript types. The pbxproj object
 * graph is untyped-by-nature (`any` values), which is honest: node-xcode
 * exposes it as raw parsed plist objects.
 */
export interface XcodeProjectLike {
  // The pbxproj object graph node-xcode hands back IS untyped — raw parsed
  // plist values of every shape (see the doc block above). Narrowing it would
  // be inventing a contract the library does not offer.
  // biome-ignore lint/suspicious/noExplicitAny: untyped pbxproj graph — see above
  hash: { project: { objects: Record<string, Record<string, any>> } };
  generateUuid: () => string;
  getFirstProject: () => {
    firstProject: {
      packageReferences?: Array<{ value: string; comment?: string }>;
    };
  };
  parseSync: () => void;
  writeSync: () => string;
}

/**
 * Ensures an ISA section exists in the pbxproj object graph.
 */
function section(
  // biome-ignore lint/suspicious/noExplicitAny: same untyped pbxproj graph as XcodeProjectLike.hash
  objects: Record<string, Record<string, any>>,
  isa: string,
  // biome-ignore lint/suspicious/noExplicitAny: returns a slice of that graph.
): Record<string, any> {
  const existing = objects[isa];
  if (existing) return existing;
  // biome-ignore lint/suspicious/noExplicitAny: ditto — a fresh ISA section.
  const created: Record<string, any> = {};
  objects[isa] = created;
  return created;
}

// node-xcode preserves the literal surrounding quotes for pbxproj values that
// contain spaces, so a target named "React Watch" parses as `"React Watch"`
// (quotes included). Strip them before comparing against a plain target name.
function unquote(value: unknown) {
  return typeof value === "string" &&
    value.length >= 2 &&
    value.startsWith('"') &&
    value.endsWith('"')
    ? value.slice(1, -1)
    : value;
}

// node-xcode also writes values LITERALLY, so a value with characters outside
// the pbxproj unquoted-safe set must carry its own quotes. This bites exactly
// on REGISTRY installs: the package realpath lands in pnpm's store dir
// (".pnpm/react-watchos@0.1.0_@babel+core@…"), whose "@"/"+" corrupt the
// project when written bare — CocoaPods then dies parsing it ("Dictionary
// missing ';' after key-value pair for \"relativePath\""). Workspace installs
// realpath to a clean js/ dir and never hit it.
function quoteIfNeeded(value: string): string {
  return /^[A-Za-z0-9_$./]+$/.test(value) ? value : `"${value}"`;
}

/**
 * Adds the local package reference and links each target's products. Pure
 * over a node-xcode `XcodeProject` (uses `.hash` + `.generateUuid()`), so it
 * can be unit-smoke-tested without Xcode. Idempotent by package path /
 * (target, product).
 *
 * @param project node-xcode XcodeProject
 */
function wireLocalPackage(
  project: XcodeProjectLike,
  {
    packagePath,
    targetProducts,
  }: { packagePath: string; targetProducts: Record<string, string[]> },
): { packageRef: string; linked: string[] } {
  const objects = project.hash.project.objects;
  const localRefs = section(objects, "XCLocalSwiftPackageReference");

  // 1. The local package reference (one per relativePath).
  let packageRef = Object.keys(localRefs).find(
    (k) =>
      !k.endsWith("_comment") &&
      unquote(localRefs[k].relativePath) === packagePath,
  );
  if (!packageRef) {
    packageRef = project.generateUuid();
    localRefs[packageRef] = {
      isa: "XCLocalSwiftPackageReference",
      relativePath: quoteIfNeeded(packagePath),
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
  const linked: string[] = [];

  for (const [targetName, products] of Object.entries(targetProducts)) {
    const targetUuid = Object.keys(nativeTargets).find(
      (k) =>
        !k.endsWith("_comment") &&
        unquote(nativeTargets[k].name) === targetName,
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
      .map((p: { value: string }) => frameworkPhases[p.value])
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
        .map((d: { value: string }) => d.value)
        .find(
          (v: string) => prodDeps[v] && prodDeps[v].productName === productName,
        );
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
      const inPhase = phase.files.some((f: { value: string }) => {
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
