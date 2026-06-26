import type { BuildOptions } from "esbuild";

export interface BuildTarget {
  name: string;
  /** Native target this bundle runs on (codegen/schema.mjs targets). */
  schemaTarget: string;
  entry: string;
  outfile: string;
  asset: string;
  budgetKB: number;
  /** Declared capability contract (ARCH-02): native features the bundle needs. */
  requiredFeatures: string[];
}

export const root: string;
export const bundleVersion: number;
export const targets: BuildTarget[];
export const outfile: string;
export function buildOptions(opts?: {
  minify?: boolean;
  target?: BuildTarget;
}): BuildOptions;
