import { join } from "node:path";
import { signManifest } from "../esbuild/manifest.mjs";
import { root } from "./config.mjs";

/**
 * Signs this repo's built OTA bundle so the watch will accept it (CR-4 / CR-17).
 * Thin CLI over the published `signManifest` (react-watchos/manifest) so
 * the repo and consumers sign with one implementation. Run in CI AFTER
 * `npm run build`:
 *
 *   OTA_SIGNING_KEY=<base64> OTA_SIGNING_KEY_ID=<kid> npm run ota:sign
 *
 * `signManifest` signs the exact bytes the watch verifies —
 * "v2:<kid>:<version>:<expiresAt>:<bundle.js>", matching Swift's
 * UpdatePlan.signedMessage — reading the version + bundle from
 * dist/manifest.json so the signed bytes can't disagree with what's served.
 * The build emits the manifest with `signature: null`; signing is a separate
 * step so the key never touches a dev build.
 *
 * Optional revocation lever: set OTA_SIGNING_EXPIRES_DAYS=<n> to bind an
 * expiry into the signature — the watch refuses the bundle (at save AND at
 * every boot re-verify) once it lapses, so a leaked/superseded artifact can't
 * be replayed forever. Unset = the signature never expires.
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

const expiresDays = process.env.OTA_SIGNING_EXPIRES_DAYS;
const expiresAt = expiresDays
  ? Math.trunc(Date.now() / 1000 + Number(expiresDays) * 86400)
  : undefined;
if (expiresDays && !(Number(expiresDays) > 0)) {
  console.error("OTA_SIGNING_EXPIRES_DAYS must be a positive number of days.");
  process.exit(1);
}

try {
  const {
    signature,
    version,
    expiresAt: bound,
  } = signManifest({
    distDir: join(root, "dist"),
    keyId,
    privateKeySeedBase64: seedB64,
    ...(expiresAt !== undefined ? { expiresAt } : {}),
  });
  console.log(
    `signed manifest v${version} with key '${keyId}' ` +
      `(${signature.length}-char base64 signature; ` +
      `${bound ? `expires ${new Date(bound * 1000).toISOString()}` : "no expiry"})`,
  );
} catch (error) {
  console.error(`ota:sign failed — ${error.message}`);
  process.exit(1);
}
