import type { BuildOptions } from "esbuild";

export const root: string;
export const outfile: string;
export const assets: string[];
export function buildOptions(opts?: { minify?: boolean }): BuildOptions;
