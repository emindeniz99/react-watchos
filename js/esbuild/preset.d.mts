import type { BuildOptions, Plugin } from "esbuild";

export const rendererRoot: string;
export const shimEntry: string;

export function watchBuildOptions(opts: {
  entry: string;
  outfile: string;
  minify?: boolean;
  nodePaths?: string[];
  plugins?: Plugin[];
}): BuildOptions;

import type { OTAManifest } from "./manifest.mjs";

export interface BundleTarget {
  entry: string;
  outfile: string;
  /** Label for the build log (defaults to the outfile). */
  name?: string;
  /** Extra esbuild `define`s merged into the preset's (e.g. an OTA URL). */
  define?: Record<string, string>;
  /** esbuild plugins forwarded to the preset (e.g. the React Compiler). */
  plugins?: Plugin[];
  /** Stamp `manifest.json` next to the bundle (app bundle only). */
  manifest?: {
    version: number;
    requiredFeatures?: string[];
    minBridgeProtocol?: number;
    bundleFileName?: string;
    signature?: string | null;
  };
}

/** Build one or more watch bundles through the preset in a single call.
 *  Lazily imports esbuild (a peer dependency). */
export function buildBundles(
  targets: BundleTarget[],
  opts?: { minify?: boolean; nodePaths?: string[] },
): Promise<
  Array<{ name: string; outfile: string; sizeKB: number; manifest?: OTAManifest }>
>;
