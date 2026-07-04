const fs = require("node:fs");
const path = require("node:path");

// Resolves the absolute on-disk path of the react-watchos SwiftPM host
// (the directory containing Package.swift), then expresses it relative to the
// generated .xcodeproj directory so it can be used as an
// XCLocalSwiftPackageReference.relativePath.
//
// This is what replaces the monorepo-only hardcoded `../../swift`: the package
// finds its OWN install dir via `require.resolve`, so it works for an external
// `npm i` consumer too. The Swift host ships INSIDE the package at
// `<pkg>/swift` — the package root is js/, so it lives at js/swift, and that's
// the SAME layout in this monorepo and when installed from npm.
//
// `require.resolve("react-watchos/package.json")` is resolved from the
// project root (the consumer's app dir) so it picks the consumer's installed
// copy, not whichever copy is nearest this plugin file.

/**
 * Absolute path to the SwiftPM host directory (contains Package.swift).
 * @param {string} projectRoot
 */
function resolveSwiftPackageDir(projectRoot) {
  const pkgJson = require.resolve("react-watchos/package.json", {
    paths: [projectRoot],
  });
  const pkgDir = path.dirname(pkgJson);
  const dir = path.join(pkgDir, "swift"); // swift/ ships inside the package
  if (fs.existsSync(path.join(dir, "Package.swift"))) return dir;
  throw new Error(
    `[react-watchos] could not locate the Swift host (Package.swift) ` +
      `at ${dir}.`,
  );
}

/**
 * Path to the Swift host, relative to the .xcodeproj directory (e.g. ios/),
 * for use as XCLocalSwiftPackageReference.relativePath. apple-targets writes
 * the pbxproj under `<projectRoot>/ios/<name>.xcodeproj`, so the reference is
 * relative to that ios/ dir.
 * @param {string} projectRoot
 * @param {string} iosProjectDir
 */
function swiftPackageRelativePath(projectRoot, iosProjectDir) {
  const abs = resolveSwiftPackageDir(projectRoot);
  return path.relative(iosProjectDir, abs);
}

module.exports = { resolveSwiftPackageDir, swiftPackageRelativePath };
