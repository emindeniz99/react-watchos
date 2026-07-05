// Expo config-plugin entry point. Listing "react-watchos" in an Expo app's
// `plugins` resolves to this exact filename — Expo's zero-config plugin lookup
// hard-codes `app.plugin.js`, so this one-line CommonJS shim is the single
// unavoidable .js in the package. The implementation is real TypeScript in
// plugin/ (index.cts), run by the consumer's Node 24 native type stripping.
module.exports = require("./plugin/index.cts");
