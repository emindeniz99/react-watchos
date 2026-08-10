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
 * @returns whatever the consumer's copy exports — callers narrow it
 */
function requireFromProject(projectRoot: string, id: string): any {
  try {
    return require(require.resolve(id, { paths: [projectRoot] }));
  } catch {
    return require(id);
  }
}

/**
 * The @expo/config-plugins API the plugin uses. Typed as our own (dev-dep)
 * copy's surface — the consumer's resolved copy is API-compatible (peerDep).
 */
function loadConfigPlugins(
  projectRoot: string,
): typeof import("@expo/config-plugins") {
  return requireFromProject(projectRoot, "@expo/config-plugins");
}

/**
 * The @bacons/apple-targets `withTargetsDir` plugin (no published types).
 */
function loadAppleTargets(
  projectRoot: string,
): import("@expo/config-plugins").ConfigPlugin<{
  appleTeamId?: string | undefined;
}> {
  return requireFromProject(projectRoot, "@bacons/apple-targets/app.plugin");
}

// `xcode` / `@expo/plist` are transitive deps of config-plugins /
// apple-targets, not hoisted next to a post-prebuild script under pnpm —
// resolve them through a package that owns them. (Reused by scripts that run
// outside Expo.)
function loadTransitive(id: string, projectRoot: string): any {
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
 */
const loadXcode = (
  projectRoot: string,
): {
  project: (
    pbxPath: string,
  ) => import("./wireLocalPackage.cts").XcodeProjectLike;
} => loadTransitive("xcode", projectRoot);

/**
 * The plist XML builder/parser used for the target Info.plist merge.
 *
 * `@expo/plist`, not the `plist` package on npm, for two reasons. It is the
 * only one we can load: this plugin is CommonJS by construction (Expo resolves
 * `app.plugin.js` -> `dist-node/plugin.cjs`, every plugin file is `.cts`, and
 * `loadTransitive` is a synchronous `require`), while `plist` went ESM-only at
 * 4.0.0 and 5.0.0's `exports` map offers only `browser`/`import` conditions —
 * `require("plist")` on 5.0.0 dies with ERR_PACKAGE_PATH_NOT_EXPORTED, and
 * there is no CJS-capable release between 3.x and 5.x. And it is the RIGHT one:
 * `@expo/plist` is what `@expo/config-plugins` and `@bacons/apple-targets`
 * themselves use to write the Info.plist and entitlements we merge into, so we
 * read and rewrite with the same serializer rather than a second one whose
 * formatting differs. It ships CommonJS with an `exports.default`.
 */
const loadPlist = (
  projectRoot: string,
): {
  parse: (xml: string) => Record<string, unknown>;
  build: (obj: Record<string, unknown>) => string;
} => {
  const mod = loadTransitive("@expo/plist", projectRoot);
  return mod.default ?? mod;
};

module.exports = {
  requireFromProject,
  loadConfigPlugins,
  loadAppleTargets,
  loadXcode,
  loadPlist,
};
