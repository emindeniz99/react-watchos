// The QuickJS-correct esbuild preset, exported as `react-watchos/build`
// so consumers don't copy this config. It pins the settings the watch engine
// needs: the shims are force-injected before react/scheduler init, ES2020
// (both Bellard quickjs and quickjs-ng cover it), a platform-neutral IIFE
// (no Node/browser globals; one self-contained script the runtime evals).
//
// The preset resolves its OWN install-shims.ts, so a consumer only supplies
// their entry + outfile. Every build through the preset is gated by
// `singleCopyPlugin`: two copies of react in one bundle break hooks at boot,
// and only the module graph can prove there is one (see single-copy.mts).

import { mkdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BuildOptions, Plugin } from "esbuild";
import { type OTAManifest, writeOTAManifest } from "./manifest.mts";
import { reactCompilerPlugin } from "./react-compiler.mts";
import { singleCopyPlugin } from "./single-copy.mts";

export { reactCompilerPlugin } from "./react-compiler.mts";
export {
  findDuplicateCopies,
  SINGLE_COPY_PACKAGES,
  singleCopyPlugin,
} from "./single-copy.mts";

const here = dirname(fileURLToPath(import.meta.url));

/** This package's js/ root (build/ lives directly under it). */
export const rendererRoot = join(here, "..");

/** The shim entry esbuild must `inject` (captures setTimeout & co. first). */
export const shimEntry = join(rendererRoot, "src/install-shims.ts");

/** Options for {@link watchBuildOptions}. */
export interface WatchBuildOptions {
  /** App entry (e.g. src/entry.tsx). */
  entry?: string;
  /** Where to write the IIFE bundle. */
  outfile?: string;
  /**
   * Minify (renames locals, drops whitespace/comments). Defaults to `false`
   * here (`watchBuildOptions` — dev + hand-assembly) and to `true` in
   * {@link buildBundles} (the shipping entry); see the WHY comment at each
   * default. Measured on this repo's own bundles: app 605 KB -> 195 KB (-68%),
   * widget ~501 KB -> ~150 KB (-70%); a reporting consumer's widget went
   * 1065 KB -> 476 KB
   * (-55%). Bytes are not the main prize — run through the reference C host
   * (`tools/embed-smoke/run.sh`, the exact embedding sequence JSRuntime.swift
   * uses) the same app bundle boots in 31.7 ms (parse 24.5 + eval 7.3) against
   * 44.1 ms (36.1 + 8.0) unminified, and holds a 1.4 MB QuickJS heap against
   * 2.1 MB. A third less heap matters on the platform where memory is the
   * first wall.
   *
   * The cost is real and it is exactly one thing: React's production frame
   * builder reads `fn.displayName || fn.name` and nothing here sets a
   * displayName — so a USER component frame in an ErrorBoundary/inspector
   * stack reads `at t`, not `at ShoppingList`. HOST frames (`at VStack`,
   * `at Text`) are string literals in src/components.ts and survive, and the
   * diagnostics ring is minification-immune. The name is recoverable after the
   * fact through the map ({@link WatchBuildOptions.sourcemap}, on by default —
   * `pnpm symbolicate`), or kept in the bundle up front for +17 KB
   * ({@link WatchBuildOptions.keepNames}).
   *
   * NEVER add `mangleProps` alongside this. The wire protocol ships prop names
   * verbatim (src/serialize.ts) and the `__host` bridge is property names, so
   * renaming properties would silently break rendering and every native call.
   * Plain `minify` renames LOCALS only — which is exactly what makes it safe.
   */
  minify?: boolean;
  /**
   * Emit a source map beside the bundle. Defaults to **`true`**, as
   * `"external"`: the map is written to `<outfile>.map` and NOTHING is added to
   * the bundle itself — no `sourceMappingURL` comment, so the shipped bytes and
   * therefore the OTA `releaseId` (an FNV-1a over exactly those bytes) are
   * identical with it on or off. The map is a build artifact for symbolicating
   * a stack after the fact; the watch never reads it, and it must never be
   * copied into a target's assets.
   *
   * It is worth having because the engine we ship reports enough to use it.
   * Measured on the vendored quickjs-ng (tools/vendored-qjs), a minified frame
   * reads `at n (bundle.js:1:30)` — line AND column — and that resolves through
   * the map to the original file, line, column and name. (Bellard's QuickJS,
   * which `apt-get install quickjs` provides and which this repo no longer
   * uses anywhere, reports neither, which is how "source maps are useless
   * here" became folklore.)
   */
  sourcemap?: boolean;
  /**
   * Keep original function names through minification (esbuild `keepNames`).
   * Defaults to **`false`**.
   *
   * Minify renames locals, so React's production frame builder — which reads
   * `fn.displayName || fn.name` — reports YOUR components as `at t`. This puts
   * the real names back, with no map and no symbolication step, at a measured
   * cost of +17.4 KB on the app bundle (199,674 -> 217,444 B, +8.9%) and
   * +14.0 KB on the widget (+9.4%). Off by default because the source map
   * recovers the same information for free at rest; turn it on when stacks are
   * read by something that cannot symbolicate.
   */
  keepNames?: boolean;
  /**
   * Run the React Compiler over app + renderer source (auto-memoization ->
   * fewer commits). Needs Babel dev deps — see esbuild/react-compiler.mts.
   */
  reactCompiler?: boolean;
  /**
   * Extra resolution roots. This is an esbuild *fallback*, consulted only when
   * normal walk-up resolution fails — it cannot override a react the renderer
   * already has next to it, so it is not a dedupe mechanism. Matching version
   * ranges are; `singleCopyPlugin` is what proves it.
   */
  nodePaths?: string[] | undefined;
  /** Extra esbuild plugins. */
  plugins?: Plugin[];
}

/** esbuild BuildOptions for a QuickJS-targeted watch bundle. */
export function watchBuildOptions({
  entry,
  outfile,
  // Deliberately the OPPOSITE default from `buildBundles` below — the two
  // disagree on purpose. This is the function `react-watchos dev` builds the
  // live-reload bundle with, where named component frames in a stack are the
  // whole reason you are looking at it; `buildBundles` is what ships.
  minify = false,
  sourcemap = true,
  keepNames = false,
  reactCompiler = false,
  nodePaths,
  plugins = [],
}: WatchBuildOptions = {}): BuildOptions {
  if (!entry) throw new Error("watchBuildOptions: `entry` is required");
  if (!outfile) throw new Error("watchBuildOptions: `outfile` is required");
  if (reactCompiler) plugins = [reactCompilerPlugin(), ...plugins];
  return {
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: "iife",
    inject: [shimEntry],
    target: "es2020",
    // This package ships its TSX as source WITHOUT a tsconfig.json in the
    // tarball, and esbuild's per-file tsconfig discovery stops at the package
    // boundary — so from a registry install the renderer's own .tsx would fall
    // back to the CLASSIC transform (React.createElement) and crash at runtime
    // with "React is not defined". Workspace installs mask this: the pnpm
    // symlink realpaths into js/, where tsconfig.json (jsx: react-jsx) exists.
    // Pin the automatic runtime so the preset never depends on discovery.
    jsx: "automatic",
    platform: "neutral",
    mainFields: ["module", "main"],
    conditions: ["import", "default"],
    // QuickJS has no `process`, so every `process.env.X` the bundle reads must be
    // statically replaced here or the bundle throws at load. NODE_ENV (react/
    // scheduler) and BUNDLE_VERSION (read at module load in update.ts) are the
    // two the renderer itself reads; default BUNDLE_VERSION to "1" so a bundle
    // can never crash on it. `buildBundles` overrides it from manifest.version.
    define: {
      "process.env.NODE_ENV": '"production"',
      "process.env.BUNDLE_VERSION": '"1"',
    },
    plugins: [...plugins, singleCopyPlugin()],
    // Read by singleCopyPlugin to count react copies in the module graph.
    metafile: true,
    ...(nodePaths ? { nodePaths } : {}),
    minify,
    // "external": the map is written next to the outfile and NO
    // sourceMappingURL comment is appended, so the bytes that ship — and the
    // OTA releaseId hashed from exactly those bytes — are unchanged whether
    // this is on or off. The map is for symbolicating a stack later, not for
    // the watch, which never reads it.
    sourcemap: sourcemap ? "external" : false,
    keepNames,
    logLevel: "info",
  };
}

/** The OTA-manifest slice a {@link BundleTarget} may stamp. */
export interface BundleManifestInput {
  version: number;
  requiredFeatures?: string[];
  minBridgeProtocol?: number;
  bundleFileName?: string;
  signature?: string | null;
  expiresAt?: number;
}

/** One bundle {@link buildBundles} builds. */
export interface BundleTarget {
  entry: string;
  outfile: string;
  name?: string;
  define?: Record<string, string>;
  plugins?: Plugin[];
  manifest?: BundleManifestInput;
}

/** One built bundle's result. */
export interface BuildBundleResult {
  name: string;
  outfile: string;
  sizeKB: number;
  manifest?: OTAManifest | undefined;
}

/** Shared options for a whole {@link buildBundles} run (per-target knobs live
 *  on {@link BundleTarget}). */
export interface BuildBundlesOptions {
  /**
   * Minify. Defaults to **`true`** here — this is the shipping entry, the
   * opposite default from {@link WatchBuildOptions.minify} (`false`, dev), on
   * purpose. See that JSDoc for the measured bytes/heap/boot and the one cost
   * (your own component frames read `at t`).
   */
  minify?: boolean;
  /** @see WatchBuildOptions.sourcemap */
  sourcemap?: boolean;
  /** @see WatchBuildOptions.keepNames */
  keepNames?: boolean;
  /** @see WatchBuildOptions.reactCompiler */
  reactCompiler?: boolean;
  /** @see WatchBuildOptions.nodePaths */
  nodePaths?: string[];
}

/**
 * Build one or more watch bundles in a single call — the batteries-included
 * companion to {@link watchBuildOptions}, so a consumer with both a watch UI and
 * a widget (two bundles, ARCH-03) writes ONE build script instead of copying the
 * esbuild boilerplate per target. Each target runs through the same preset; a
 * target may add a `define` (e.g. baking `REACT_WATCH_OTA_URL` into the bundle)
 * and/or a `manifest` (stamp `manifest.json` next to the bundle via
 * `writeOTAManifest` — only the app bundle needs this; widget bundles are
 * shipped, not OTA'd). esbuild is imported lazily so importing this module for
 * `watchBuildOptions` alone never requires esbuild to be installed.
 *
 * A target may also pass `plugins` (esbuild plugins like the React Compiler,
 * forwarded to the preset). The manifest is stamped against the target's real
 * outfile name, so a bundle not named `bundle.js` still hashes correctly.
 */
export async function buildBundles(
  targets: BundleTarget[],
  {
    // Minified by DEFAULT, the opposite of `watchBuildOptions` above and for
    // the opposite reason: this is the SHIPPING entry (multi-target + OTA
    // manifest stamp), where -68% bytes, a third less QuickJS heap and ~28%
    // faster boot beat readable USER component frames. Pass `{ minify: false }`
    // when you need those frames back out of a shipped bundle.
    minify = true,
    sourcemap = true,
    keepNames = false,
    reactCompiler = false,
    nodePaths,
  }: BuildBundlesOptions = {},
): Promise<BuildBundleResult[]> {
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error("buildBundles: pass a non-empty array of targets");
  }
  let build: typeof import("esbuild").build;
  try {
    ({ build } = await import("esbuild"));
  } catch (err) {
    // Only relabel a genuine "esbuild isn't installed"; preserve any other
    // import-time failure (e.g. a corrupt platform binary) so it isn't hidden
    // behind a misleading "run npm i" (fail loud).
    if ((err as NodeJS.ErrnoException)?.code === "ERR_MODULE_NOT_FOUND") {
      throw new Error(
        "buildBundles needs esbuild installed in your project (npm i -D esbuild). " +
          "If you bring your own bundler, use watchBuildOptions instead.",
        { cause: err },
      );
    }
    throw err;
  }
  const results: BuildBundleResult[] = [];
  for (const target of targets) {
    const { entry, outfile, name = outfile, define, plugins, manifest } = target;
    if (!entry || !outfile) {
      throw new Error("buildBundles: each target needs `entry` and `outfile`");
    }
    mkdirSync(dirname(outfile), { recursive: true });
    const options = watchBuildOptions({
      entry,
      outfile,
      minify,
      sourcemap,
      keepNames,
      reactCompiler,
      nodePaths,
      plugins,
    });
    options.define = {
      ...options.define,
      ...(define ?? {}),
      // The bundle's BUNDLE_VERSION (its anti-rollback/freshness identity) is the
      // SAME number as the OTA manifest's `version` — derive it from there so the
      // two can't drift, and so the bundle never ships with the unreplaced
      // `process.env.BUNDLE_VERSION` that would crash it in QuickJS.
      ...(manifest?.version !== undefined
        ? {
            "process.env.BUNDLE_VERSION": JSON.stringify(
              String(manifest.version),
            ),
          }
        : {}),
    };
    await build(options);

    const sizeKB = Number((statSync(outfile).size / 1024).toFixed(0));
    // Stamp the manifest against THIS bundle's real file name (not a hardcoded
    // bundle.js), so `releaseId` hashes the file written here and the manifest's
    // `bundle` URL points at it. A target may still override via manifest.bundleFileName.
    const stamped = manifest
      ? writeOTAManifest({
          distDir: dirname(outfile),
          bundleFileName: basename(outfile),
          ...manifest,
        })
      : undefined;
    console.log(
      `${name} bundle: ${sizeKB} KB${minify ? " (minified)" : ""}` +
        (stamped ? ` (OTA v${stamped.version} ${stamped.releaseId})` : ""),
    );
    results.push({ name, outfile, sizeKB, manifest: stamped });
  }
  return results;
}
