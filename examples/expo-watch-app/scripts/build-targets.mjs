import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBundles } from "react-watchos/build";
import {
  generateSigningKey,
  signManifest,
} from "react-watchos/manifest";

// Builds both watch bundles (ARCH-03: the app UI + the widget) in one call via
// the package's `buildBundles` helper — no per-target esbuild boilerplate, just
// the two things that differ (entry + outfile). The watch bundle bakes in
// REACT_WATCH_OTA_URL and gets an OTA `manifest.json` stamped next to it; the
// widget bundle is shipped, not OTA'd, so it needs neither.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const minify = process.argv.includes("--minify") || !!process.env.MINIFY;

await buildBundles(
  [
    {
      name: "watch",
      entry: join(root, "watch-ui/entry.tsx"),
      outfile: join(root, "targets/watch/assets/bundle.js"),
      // Inject the OTA endpoint the watch UI's "Check for update" reads (empty
      // unless you set REACT_WATCH_OTA_URL).
      define: {
        "process.env.REACT_WATCH_OTA_URL": JSON.stringify(
          process.env.REACT_WATCH_OTA_URL ?? "",
        ),
      },
      // OTA compatibility version — bump only on a breaking change; a
      // same-version release with a new releaseId is a hot fix. This UI uses
      // WatchConnectivity (connectivity) and OTA (network + ota).
      manifest: {
        version: 1,
        requiredFeatures: ["connectivity", "network", "ota"],
      },
    },
    {
      name: "widget",
      entry: join(root, "watch-ui/widget.entry.tsx"),
      outfile: join(root, "targets/widget/assets/bundle.js"),
    },
  ],
  // reactCompiler: the published preset flag (NF-28) — auto-memoizes app +
  // renderer components so React emits fewer commits (needs the Babel dev
  // deps in package.json).
  { minify, reactCompiler: true, nodePaths: [join(root, "node_modules")] },
);

// NF-29: never leave the stamped manifest unsigned, even in the demo — an
// unsigned OTA channel hands the full host surface to whoever answers the
// manifest URL, and examples get copied verbatim. Production/CI signs with
// the real secret (OTA_SIGNING_KEY + OTA_SIGNING_KEY_ID); local dev falls
// back to a per-checkout keypair persisted at .ota-dev-key.json (gitignored).
// Trust the printed public key in targets/watch/WatchApp.swift to let the
// watch accept these dev-signed updates.
const assetsDir = join(root, "targets/watch/assets");
let keyId = process.env.OTA_SIGNING_KEY_ID;
let privateKeySeedBase64 = process.env.OTA_SIGNING_KEY;
if (!keyId || !privateKeySeedBase64) {
  const keyFile = join(root, ".ota-dev-key.json");
  let devKey;
  if (existsSync(keyFile)) {
    devKey = JSON.parse(readFileSync(keyFile, "utf8"));
  } else {
    devKey = generateSigningKey();
    writeFileSync(keyFile, `${JSON.stringify(devKey, null, 2)}\n`);
    console.log(
      `Generated a DEV OTA signing key at ${keyFile} (gitignored).\n` +
        "Trust it in targets/watch/WatchApp.swift so the watch accepts " +
        "dev-signed updates:\n" +
        `  ota: .init(signerPublicKeys: ["${devKey.keyId}": "${devKey.publicKeyBase64}"])`,
    );
  }
  keyId = devKey.keyId;
  privateKeySeedBase64 = devKey.privateKeySeedBase64;
}
const signed = signManifest({ distDir: assetsDir, keyId, privateKeySeedBase64 });
console.log(`OTA manifest signed (keyId ${signed.keyId}, v${signed.version})`);
