/**
 * esbuild plugin that runs the React Compiler (babel-plugin-react-compiler)
 * over app source AND this package's own components. The compiler
 * auto-memoizes, so React re-renders less and produces fewer commits —
 * fewer serialize/decode trips across the bridge (compounds with the
 * renderer's wire-identical commit skip, NF-21). React 19 ships the compiler
 * runtime (`react/compiler-runtime`), so it adds no runtime dependency.
 *
 * Published as part of `react-watchos/build` (NF-28): enable with
 * `watchBuildOptions({ reactCompiler: true })` or per-target in
 * `buildBundles`. Babel is imported lazily on first use, so importing the
 * preset never requires it — enabling does. Install the dev deps:
 *
 *   npm i -D @babel/core @babel/preset-typescript @babel/preset-react \
 *            babel-plugin-react-compiler
 *
 * The compiler targets React 19 exactly (`target: "19"`) — the version this
 * package pins as a peer.
 */
import type { transformAsync as TransformAsync } from "@babel/core";
import type { OnLoadArgs, OnLoadResult, Plugin, PluginBuild } from "esbuild";

export function reactCompilerPlugin(): Plugin {
  let transformAsyncPromise: Promise<typeof TransformAsync> | undefined;
  const loadTransform = () => {
    transformAsyncPromise ??= import("@babel/core").then(
      (babel) => babel.transformAsync,
      (err) => {
        throw new Error(
          "reactCompiler needs Babel installed: npm i -D @babel/core " +
            "@babel/preset-typescript @babel/preset-react " +
            "babel-plugin-react-compiler",
          { cause: err },
        );
      },
    );
    return transformAsyncPromise;
  };
  return {
    name: "react-compiler",
    setup(build: PluginBuild) {
      build.onLoad(
        { filter: /\.[jt]sx?$/ },
        async (args: OnLoadArgs): Promise<OnLoadResult | undefined> => {
          // Skip third-party node_modules, but NOT this package's own source:
          // an installed consumer resolves the renderer at
          // node_modules/react-watchos/src/*, and its components
          // (NavigationStack & co.) deserve the same memoization as app code.
          const nm = args.path.lastIndexOf("node_modules");
          if (nm >= 0) {
            const after = args.path.slice(nm + "node_modules".length + 1);
            if (
              !after.startsWith("react-watchos/") &&
              !after.startsWith("react-watchos\\")
            ) {
              return undefined;
            }
          }
          const transformAsync = await loadTransform();
          const { readFile } = await import("node:fs/promises");
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
              // development: false -> production jsx-runtime (jsx/jsxs), not the
              // larger jsx-dev-runtime. This is the shipped watch bundle; babel
              // would otherwise emit jsxDEV when BABEL_ENV/NODE_ENV isn't set.
              [
                "@babel/preset-react",
                { runtime: "automatic", development: false },
              ],
            ],
            plugins: [["babel-plugin-react-compiler", { target: "19" }]],
          });
          return { contents: result?.code ?? source, loader: "js" };
        },
      );
    },
  };
}
