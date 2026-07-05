// The QuickJS-correct esbuild preset, exported as `react-watchos/build`
// so consumers don't copy this config. It pins the settings the watch engine
// needs: the shims are force-injected before react/scheduler init, ES2020
// (both Bellard quickjs and quickjs-ng cover it), a platform-neutral IIFE
// (no Node/browser globals; one self-contained script the runtime evals).
//
// The preset resolves its OWN install-shims.ts, so a consumer only supplies
// their entry + outfile. `nodePaths` should point at the consumer's
// node_modules so the renderer's react/react-reconciler imports resolve to
// the consumer's single copy (see README — React dedupe).

import { mkdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BuildOptions, Plugin } from "esbuild";
import { type OTAManifest, writeOTAManifest } from "./manifest.mts";
import { reactCompilerPlugin } from "./react-compiler.mts";

export { reactCompilerPlugin } from "./react-compiler.mts";

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
  /** Minify (≈halves size; off keeps traces). */
  minify?: boolean;
  /**
   * Run the React Compiler over app + renderer source (auto-memoization ->
   * fewer commits). Needs Babel dev deps — see esbuild/react-compiler.mts.
   */
  reactCompiler?: boolean;
  /** Extra resolution roots (consumer's node_modules, for single-React dedupe). */
  nodePaths?: string[] | undefined;
  /** Extra esbuild plugins. */
  plugins?: Plugin[];
}

/** esbuild BuildOptions for a QuickJS-targeted watch bundle. */
export function watchBuildOptions({
  entry,
  outfile,
  minify = false,
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
    plugins,
    ...(nodePaths ? { nodePaths } : {}),
    minify,
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
    minify = false,
    reactCompiler = false,
    nodePaths,
  }: { minify?: boolean; reactCompiler?: boolean; nodePaths?: string[] } = {},
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
