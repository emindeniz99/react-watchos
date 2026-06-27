import { join } from "node:path";
import { signManifest } from "../esbuild/manifest.mjs";
import { root } from "./config.mjs";

/**
 * Signs this repo's built OTA bundle so the watch will accept it (CR-4 / CR-17).
 * Thin CLI over the published `signManifest` (react-native-watchos/manifest) so
 * the repo and consumers sign with one implementation. Run in CI AFTER
 * `npm run build`:
 *
 *   OTA_SIGNING_KEY=<base64> OTA_SIGNING_KEY_ID=<kid> npm run ota:sign
 *
 * `signManifest` signs the exact bytes the watch verifies —
 * "v1:<kid>:<version>:<bundle.js>", matching Swift's UpdatePlan.signedMessage —
 * reading the version + bundle from dist/manifest.json so the signed bytes can't
 * disagree with what's served. The build emits the manifest with
 * `signature: null`; signing is a separate step so the key never touches a dev
 * build.
 */
const seedB64 = process.env.OTA_SIGNING_KEY;
if (!seedB64) {
  console.error(
    "OTA_SIGNING_KEY is not set (base64 of the raw 32-byte Ed25519 seed from ota:keygen).",
  );
  process.exit(1);
}
const keyId = process.env.OTA_SIGNING_KEY_ID;
if (!keyId) {
  console.error(
    "OTA_SIGNING_KEY_ID is not set — use the key id from ota:keygen.",
  );
  process.exit(1);
}

try {
  const { signature, version } = signManifest({
    distDir: join(root, "dist"),
    keyId,
    privateKeySeedBase64: seedB64,
  });
  console.log(
    `signed manifest v${version} with key '${keyId}' ` +
      `(${signature.length}-char base64 signature)`,
  );
} catch (error) {
  console.error(`ota:sign failed — ${error.message}`);
  process.exit(1);
}
