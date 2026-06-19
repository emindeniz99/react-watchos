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
