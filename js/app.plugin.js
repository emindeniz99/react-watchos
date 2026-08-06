// Expo config-plugin entry point. Listing "react-watchos" in an Expo app's
// `plugins` resolves to this exact filename — Expo's zero-config plugin lookup
// hard-codes `app.plugin.js`, so it cannot be renamed. The package is
// `"type": "module"`, so this file is ESM: it re-exports the COMPILED plugin
// (dist-node/plugin.cjs, built from plugin/index.cts by scripts/build-node.ts;
// Node refuses to type-strip .cts under node_modules, so the shipped package
// can't load the TypeScript source directly). Node >= 22.12 can also plain
// `require()` this file (no top-level await), and Expo's plugin resolver
// unwraps `.default` — both load paths get the plugin function.
import plugin from "./dist-node/plugin.cjs";
export default plugin;
