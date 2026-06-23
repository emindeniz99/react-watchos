const fs = require("node:fs");
const path = require("node:path");

// Resolves the absolute on-disk path of the react-native-watchos SwiftPM host
// (the directory containing Package.swift), then expresses it relative to the
// generated .xcodeproj directory so it can be used as an
// XCLocalSwiftPackageReference.relativePath.
//
// This is what replaces the monorepo-only hardcoded `../../swift`: the package
// finds its OWN install dir via `require.resolve`, so it works for an external
// `npm i` consumer too. Two layouts are supported:
//   • published package — Package.swift ships INSIDE the package: <pkg>/swift
//   • this monorepo      — js/ is the package; swift/ is a SIBLING: js/../swift
//
// `require.resolve("react-native-watchos/package.json")` is resolved from the
// project root (the consumer's app dir) so it picks the consumer's installed
// copy, not whichever copy is nearest this plugin file.

/** Absolute path to the SwiftPM host directory (contains Package.swift). */
function resolveSwiftPackageDir(projectRoot) {
  const pkgJson = require.resolve("react-native-watchos/package.json", {
    paths: [projectRoot],
  });
  const pkgDir = path.dirname(pkgJson);
  const candidates = [
    path.join(pkgDir, "swift"), // published: swift/ inside the package
    path.join(pkgDir, "..", "swift"), // monorepo: swift/ next to js/
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "Package.swift"))) return dir;
  }
  throw new Error(
    `[react-native-watchos] could not locate the Swift host (Package.swift) ` +
      `near ${pkgDir}. Looked in: ${candidates.join(", ")}`,
  );
}

/**
 * Path to the Swift host, relative to the .xcodeproj directory (e.g. ios/),
 * for use as XCLocalSwiftPackageReference.relativePath. apple-targets writes
 * the pbxproj under `<projectRoot>/ios/<name>.xcodeproj`, so the reference is
 * relative to that ios/ dir.
 */
function swiftPackageRelativePath(projectRoot, iosProjectDir) {
  const abs = resolveSwiftPackageDir(projectRoot);
  return path.relative(iosProjectDir, abs);
}

module.exports = { resolveSwiftPackageDir, swiftPackageRelativePath };
