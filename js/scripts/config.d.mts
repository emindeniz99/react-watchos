import type { BuildOptions } from "esbuild";

export interface BuildTarget {
  name: string;
  entry: string;
  outfile: string;
  asset: string;
  budgetKB: number;
}

export const root: string;
export const bundleVersion: number;
export const targets: BuildTarget[];
export const outfile: string;
export function buildOptions(opts?: {
  minify?: boolean;
  target?: BuildTarget;
}): BuildOptions;
