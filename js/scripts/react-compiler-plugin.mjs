import { readFile } from "node:fs/promises";
import { transformAsync } from "@babel/core";

/**
 * esbuild plugin that runs the React Compiler (babel-plugin-react-compiler)
 * over our own source. The compiler auto-memoizes components, so React
 * re-renders less and produces fewer commits — fewer serialize/decode trips
 * across the bridge (compounds with the renderer's no-op-commit bailout).
 *
 * Babel does the full transform for our files (TS strip + JSX automatic +
 * react-compiler) and esbuild bundles the JS. node_modules are left to
 * esbuild. React 19 ships the compiler runtime (`react/compiler-runtime`),
 * so no extra runtime dependency is needed.
 */
export function reactCompilerPlugin() {
  return {
    name: "react-compiler",
    setup(build) {
      build.onLoad({ filter: /\.[jt]sx?$/ }, async (args) => {
        if (args.path.includes("node_modules")) return undefined;
        const source = await readFile(args.path, "utf8");
        const result = await transformAsync(source, {
          filename: args.path,
          babelrc: false,
          configFile: false,
          sourceMaps: false,
          // Babel 8 preset-typescript detects JSX from the filename
          // extension (.tsx), so no isTSX/allExtensions needed.
          presets: [
            "@babel/preset-typescript",
            ["@babel/preset-react", { runtime: "automatic" }],
          ],
          plugins: [["babel-plugin-react-compiler", { target: "19" }]],
        });
        return { contents: result?.code ?? source, loader: "js" };
      });
    },
  };
}
