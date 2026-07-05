import { generateSigningKey } from "../esbuild/manifest.mjs";

/**
 * Generates an Ed25519 keypair + a key id for OTA bundle signing (CR-4 / CR-17).
 * Thin CLI over the published `generateSigningKey` (react-watchos/manifest)
 * so the repo and consumers use one keygen.
 *
 *   node scripts/ota-keygen.ts      (or: npm run ota:keygen)
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
const { keyId, publicKeyBase64, privateKeySeedBase64 } = generateSigningKey();

console.log(`OTA key id — '${keyId}' (used below):\n`);
console.log("OTA public key (base64) — add to OTAConfig.signerPublicKeys:\n");
console.log(`  signerPublicKeys: ["${keyId}": "${publicKeyBase64}"]\n`);
console.log(
  "OTA signing key (base64) — keep SECRET; set as OTA_SIGNING_KEY in CI,\n" +
    `and set OTA_SIGNING_KEY_ID="${keyId}" alongside it:\n`,
);
console.log(`  ${privateKeySeedBase64}\n`);
