import { createPrivateKey, sign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bundleVersion, root } from "./config.mjs";

/**
 * Signs the built OTA bundle so the watch will accept it (CR-4 / CR-17). Run in
 * CI AFTER `npm run build`:
 *
 *   OTA_SIGNING_KEY=<base64> OTA_SIGNING_KEY_ID=<kid> npm run ota:sign
 *
 * It signs the exact bytes the watch verifies — "v1:<kid>:<version>:<bundle.js>",
 * matching Swift's UpdatePlan.signedMessage — with your Ed25519 private key, and
 * writes the base64 signature + the `keyId` into dist/manifest.json. The `kid`
 * is bound INTO the signed bytes (CX-007) so it can't be swapped, and it tells
 * the watch which trusted public key to verify against — the mechanism that
 * makes key rotation safe. The build emits the manifest with `signature: null`;
 * signing is a separate step so the private key never touches a dev build.
 */
const SCHEME = "v1"; // keep in lockstep with UpdatePlan.scheme

const seedB64 = process.env.OTA_SIGNING_KEY;
if (!seedB64) {
  console.error(
    "OTA_SIGNING_KEY is not set (base64 of the raw 32-byte Ed25519 seed from ota:keygen).",
  );
  process.exit(1);
}

// The signing key's id (CX-007). Bound into the signed message and recorded in
// the manifest so the watch picks the matching trusted public key. Must be
// colon-free — the signed message is `:`-delimited — matching the charset
// UpdatePlan.isValidKeyId enforces on the watch.
const keyId = process.env.OTA_SIGNING_KEY_ID;
if (!keyId || !/^[A-Za-z0-9_-]{1,64}$/.test(keyId)) {
  console.error(
    "OTA_SIGNING_KEY_ID is missing or invalid — set it to the key id from " +
      "ota:keygen (1–64 chars of [A-Za-z0-9_-], no colons).",
  );
  process.exit(1);
}

// Wrap the raw 32-byte seed in the fixed Ed25519 PKCS#8 prefix (RFC 8410) so
// Node can import it without needing the public half.
const seed = Buffer.from(seedB64, "base64");
if (seed.length !== 32) {
  console.error(`OTA_SIGNING_KEY must decode to 32 bytes, got ${seed.length}.`);
  process.exit(1);
}
const pkcs8 = Buffer.concat([
  Buffer.from("302e020100300506032b657004220420", "hex"),
  seed,
]);
const privateKey = createPrivateKey({
  key: pkcs8,
  format: "der",
  type: "pkcs8",
});

const dist = join(root, "dist");
const bundle = readFileSync(join(dist, "bundle.js"), "utf8");
const message = Buffer.from(
  `${SCHEME}:${keyId}:${bundleVersion}:${bundle}`,
  "utf8",
);
const signature = sign(null, message, privateKey).toString("base64"); // Ed25519

const manifestPath = join(dist, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.signature = signature;
manifest.keyId = keyId;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(
  `signed manifest v${bundleVersion} with key '${keyId}' ` +
    `(${signature.length}-char base64 signature)`,
);
