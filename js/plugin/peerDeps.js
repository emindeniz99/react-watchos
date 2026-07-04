const path = require("node:path");

// Resolves the consumer's peer dependencies (expo / @bacons/apple-targets and
// their transitive `xcode`/`plist`) from the PROJECT ROOT, not from this file.
//
// Why not a plain top-level `require("@expo/config-plugins")`: this plugin
// ships inside the react-watchos package, so node resolves its requires
// from the package's own location. Under pnpm's isolated node_modules (and in
// this monorepo, where the package is symlinked to js/), that location can't
// see the consumer app's @expo/config-plugins / @bacons/apple-targets. They are
// declared as peerDependencies — the consumer installs them — so we resolve
// against the project root, which is where they live for every real consumer.

/**
 * Require `id` resolved from `projectRoot` (then this file as a fallback).
 * @param {string} projectRoot
 * @param {string} id
 * @returns {any} whatever the consumer's copy exports — callers narrow it
 */
function requireFromProject(projectRoot, id) {
  try {
    return require(require.resolve(id, { paths: [projectRoot] }));
  } catch {
    return require(id);
  }
}

/**
 * The @expo/config-plugins API the plugin uses. Typed as our own (dev-dep)
 * copy's surface — the consumer's resolved copy is API-compatible (peerDep).
 * @param {string} projectRoot
 * @returns {typeof import("@expo/config-plugins")}
 */
function loadConfigPlugins(projectRoot) {
  return requireFromProject(projectRoot, "@expo/config-plugins");
}

/**
 * The @bacons/apple-targets `withTargetsDir` plugin (no published types).
 * @param {string} projectRoot
 * @returns {import("@expo/config-plugins").ConfigPlugin<{
 *   appleTeamId?: string | undefined }>}
 */
function loadAppleTargets(projectRoot) {
  return requireFromProject(projectRoot, "@bacons/apple-targets/app.plugin");
}

// `xcode` / `plist` are transitive deps of config-plugins / apple-targets, not
// hoisted next to a post-prebuild script under pnpm — resolve them through a
// package that owns them. (Reused by scripts that run outside Expo.)
/**
 * @param {string} id
 * @param {string} projectRoot
 * @returns {any}
 */
function loadTransitive(id, projectRoot) {
  const bases = ["@expo/config-plugins", "@bacons/apple-targets"];
  for (const base of bases) {
    try {
      const baseDir = path.dirname(
        require.resolve(base, { paths: [projectRoot] }),
      );
      return require(require.resolve(id, { paths: [baseDir] }));
    } catch {}
  }
  return require(id);
}

/**
 * node-xcode (no published types for 3.x — see XcodeProjectLike).
 * @param {string} projectRoot
 * @returns {{ project: (pbxPath: string) =>
 *   import("./wireLocalPackage.js").XcodeProjectLike }}
 */
const loadXcode = (projectRoot) => loadTransitive("xcode", projectRoot);

/**
 * The `plist` XML builder/parser used for the target Info.plist merge.
 * @param {string} projectRoot
 * @returns {{ parse: (xml: string) => Record<string, unknown>,
 *   build: (obj: Record<string, unknown>) => string }}
 */
const loadPlist = (projectRoot) => loadTransitive("plist", projectRoot);

module.exports = {
  requireFromProject,
  loadConfigPlugins,
  loadAppleTargets,
  loadXcode,
  loadPlist,
};
