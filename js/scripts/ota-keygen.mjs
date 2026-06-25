import { generateKeyPairSync } from "node:crypto";

/**
 * Generates an Ed25519 keypair for OTA bundle signing (CR-4 / CR-17).
 *
 *   node scripts/ota-keygen.mjs      (or: npm run ota:keygen)
 *
 * Prints the RAW 32-byte keys as base64:
 *   - public  -> ReactWatchRootView(ota: OTAConfig(publicKeyBase64: "..."))
 *   - private -> a CI secret named OTA_SIGNING_KEY, used by ota-sign.mjs.
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

console.log("OTA public key (base64) — put in OTAConfig.publicKeyBase64:\n");
console.log(`  ${toBase64(pub)}\n`);
console.log(
  "OTA signing key (base64) — keep SECRET; set as OTA_SIGNING_KEY in CI:\n",
);
console.log(`  ${toBase64(priv)}\n`);
