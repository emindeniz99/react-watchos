import { join } from "node:path";
import { MAX_SEQUENCE, signManifest } from "../esbuild/manifest.mts";
import { root } from "./config.ts";

/**
 * Signs this repo's built OTA bundle so the watch will accept it (CR-4 / CR-17).
 * Thin CLI over the published `signManifest` (react-watchos/manifest) so
 * the repo and consumers sign with one implementation. Run in CI AFTER
 * `npm run build`:
 *
 *   OTA_SIGNING_KEY=<base64> OTA_SIGNING_KEY_ID=<kid> npm run ota:sign
 *
 * `signManifest` signs the exact bytes the watch verifies —
 * "v3:<kid>:<version>:<sequence>:<expiresAt>:<bundle.js>", matching Swift's
 * UpdatePlan.signedMessage — reading the version + bundle from
 * dist/manifest.json so the signed bytes can't disagree with what's served.
 * The build emits the manifest with `signature: null`; signing is a separate
 * step so the key never touches a dev build.
 *
 * `sequence` orders publishes at the same `version`: the watch keeps the
 * highest it has accepted and refuses a lower one, so a re-served earlier
 * build is not installed. Default = the signing time in epoch seconds; set
 * OTA_SIGNING_SEQUENCE=<1..2^31-1> (a CI build number — GitHub's
 * `run_number`, not `run_id`; Swift `Int` is 32-bit on arm64_32 watches) to
 * bind an explicit one — also the remedy when the signing clock ran
 * backwards. Use timestamps OR build numbers per fleet, never both: one
 * timestamp publish outranks every build number that could follow it. The
 * bound value is printed so the CI log shows what the fleet will compare.
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

const sequenceEnv = process.env.OTA_SIGNING_SEQUENCE;
const sequence = sequenceEnv ? Number(sequenceEnv) : undefined;
if (
  sequenceEnv &&
  !(
    Number.isSafeInteger(sequence) &&
    Number(sequence) > 0 &&
    Number(sequence) <= MAX_SEQUENCE
  )
) {
  console.error(
    `OTA_SIGNING_SEQUENCE must be an integer in 1..${MAX_SEQUENCE}.`,
  );
  process.exit(1);
}

try {
  const {
    signature,
    version,
    sequence: boundSequence,
    expiresAt: bound,
  } = signManifest({
    distDir: join(root, "dist"),
    keyId,
    privateKeySeedBase64: seedB64,
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...(sequence !== undefined ? { sequence } : {}),
  });
  console.log(
    `signed manifest v${version} sequence ${boundSequence} with key '${keyId}' ` +
      `(${signature.length}-char base64 signature; ` +
      `${bound ? `expires ${new Date(bound * 1000).toISOString()}` : "no expiry"})`,
  );
} catch (error) {
  console.error(`ota:sign failed — ${(error as Error).message}`);
  process.exit(1);
}
