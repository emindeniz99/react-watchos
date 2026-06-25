import { generateKeyPairSync, randomBytes } from "node:crypto";

/**
 * Generates an Ed25519 keypair + a key id for OTA bundle signing (CR-4 / CR-17).
 *
 *   node scripts/ota-keygen.mjs      (or: npm run ota:keygen)
 *
 * Prints three values:
 *   - key id  -> add `"<kid>": "<publicKey>"` to OTAConfig.signerPublicKeys AND
 *                set OTA_SIGNING_KEY_ID=<kid> in CI (binds the kid into the
 *                signature so it can't be swapped — CX-007).
 *   - public  -> the trusted public key the watch verifies against.
 *   - private -> a CI secret named OTA_SIGNING_KEY, used by ota-sign.mjs.
 *
 * Rotation (CX-007): to swap a key, FIRST ship an app release whose
 * `signerPublicKeys` trusts BOTH the old and new kid and start signing with the
 * new one; only AFTER the fleet has that release, ship a release that drops the
 * old kid (rotate-then-revoke with an overlap window, so no device is stranded
 * unable to verify any reachable bundle). Never reuse a retired kid string.
 *
 * NEVER commit the private key. It is the only thing that lets you ship a
 * bundle the watch will run — treat it like a code-signing key.
 */
const { publicKey, privateKey } = generateKeyPairSync("ed25519");

// JWK gives the raw 32-byte values (x = public, d = private seed) as base64url.
const pub = publicKey.export({ format: "jwk" }).x;
const priv = privateKey.export({ format: "jwk" }).d;
const toBase64 = (base64url) =>
  Buffer.from(base64url, "base64url").toString("base64");

// An opaque, random, NON-key-derived id (~47 bits) — it carries no security
// weight itself (the signature + pinned map do), it just names the key so it
// can be rotated/revoked cleanly. Colon-free [A-Za-z0-9_-], matching
// UpdatePlan.isValidKeyId on the watch and the OTA_SIGNING_KEY_ID check.
const keyId = randomBytes(6).toString("base64url");

console.log(`OTA key id — '${keyId}' (used below):\n`);
console.log("OTA public key (base64) — add to OTAConfig.signerPublicKeys:\n");
console.log(`  signerPublicKeys: ["${keyId}": "${toBase64(pub)}"]\n`);
console.log(
  "OTA signing key (base64) — keep SECRET; set as OTA_SIGNING_KEY in CI,\n" +
    `and set OTA_SIGNING_KEY_ID="${keyId}" alongside it:\n`,
);
console.log(`  ${toBase64(priv)}\n`);
