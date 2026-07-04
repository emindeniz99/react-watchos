// OTA manifest helpers for a consumer's build (published as
// `react-watchos/manifest`). After you build your watch bundle with the
// preset, call `writeOTAManifest` to stamp the `manifest.json` the watch's
// `checkForUpdate` / `fetchAndApplyUpdate` fetch — so you don't hand-write the
// manifest shape or reverse-engineer the `releaseId` hash. Serve the resulting
// `manifest.json` + bundle from any static host (CDN/S3); sign at publish time
// with `signManifest` (key from `generateSigningKey`).

import {
  createPrivateKey,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// FNV-1a 64-bit content hash, byte-for-byte identical to Swift
// ReactWatchSupport.ContentHash (same offset basis + prime, UInt64 wraparound,
// lowercase hex without leading zeros). The host exposes the loaded bundle's
// ContentHash as `globalThis.__bundleReleaseId`, so JS `checkForUpdate` can
// compare it to the manifest's `releaseId` and detect a non-breaking fix that
// kept the same compatibility `version` (CX-025). Verified against Swift in
// content-hash.test (and ContentHash.swift's vectors).
const OFFSET = 0xcbf29ce484222325n;
const PRIME = 0x100000001b3n;
const MASK = 0xffffffffffffffffn;

/** @param {string} str @returns {string} FNV-1a 64-bit of the UTF-8 bytes, hex. */
export function contentHash(str) {
  let hash = OFFSET;
  for (const byte of Buffer.from(str, "utf8")) {
    hash ^= BigInt(byte);
    hash = (hash * PRIME) & MASK;
  }
  return hash.toString(16);
}

/**
 * Write the OTA `manifest.json` next to the built bundle, computing `releaseId`
 * (the freshness signal) from the bundle bytes. `version` is the anti-rollback
 * compatibility integer (bump only on a breaking change); `requiredFeatures` /
 * `minBridgeProtocol` are the capability contract the watch gates on (ARCH-01/02).
 * `signature` is left null — fill it at publish time with `signManifest`.
 *
 * @param {{
 *   distDir: string,
 *   bundleFileName?: string,
 *   version: number,
 *   requiredFeatures?: string[],
 *   minBridgeProtocol?: number,
 *   signature?: string | null,
 * }} opts
 * @returns {object} the manifest written.
 */
export function writeOTAManifest({
  distDir,
  bundleFileName = "bundle.js",
  version,
  requiredFeatures = [],
  minBridgeProtocol = 1,
  signature = null,
}) {
  const releaseId = contentHash(
    readFileSync(join(distDir, bundleFileName), "utf8"),
  );
  const manifest = {
    version,
    bundle: bundleFileName,
    signature,
    releaseId,
    requiredFeatures,
    minBridgeProtocol,
  };
  writeFileSync(
    join(distDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

// The signing scheme prefix, in lockstep with Swift's UpdatePlan.scheme. The
// signed message is `<scheme>:<keyId>:<version>:<bundle.js>` — exactly the bytes
// ReactWatchSupport.UpdatePlan.signedMessage rebuilds and CryptoKit verifies
// (pinned by OTASigningInteropTests). Single-sourced here so the published
// signer and the watch's verifier can't drift.
const SIGN_SCHEME = "v1";

// A raw 32-byte Ed25519 seed wrapped in the fixed PKCS#8 prefix (RFC 8410), so
// Node imports it without the public half.
function privateKeyFromSeed(seedBase64) {
  const seed = Buffer.from(seedBase64, "base64");
  if (seed.length !== 32) {
    throw new Error(
      `signing key must decode to 32 bytes, got ${seed.length} — pass the ` +
        "base64 seed from generateSigningKey()",
    );
  }
  return createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      seed,
    ]),
    format: "der",
    type: "pkcs8",
  });
}

/**
 * Generate an Ed25519 keypair for OTA signing (CR-4 / CR-17). The returned
 * `publicKeyBase64` is the trusted key the watch verifies against — add it to
 * `OTAConfig.signerPublicKeys` keyed by `keyId`. Keep `privateKeySeedBase64`
 * SECRET (a CI secret, e.g. `OTA_SIGNING_KEY`); it's the only thing that lets
 * you ship a bundle the watch will run. `keyId` is an opaque, colon-free name
 * (it carries no key material) so a key can be rotated/revoked cleanly.
 *
 * @returns {{ keyId: string, publicKeyBase64: string, privateKeySeedBase64: string }}
 */
export function generateSigningKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  // JWK exposes the raw 32-byte values (x = public, d = private seed) base64url.
  const toBase64 = (b64url) =>
    Buffer.from(b64url, "base64url").toString("base64");
  return {
    keyId: randomBytes(6).toString("base64url"),
    publicKeyBase64: toBase64(publicKey.export({ format: "jwk" }).x),
    privateKeySeedBase64: toBase64(privateKey.export({ format: "jwk" }).d),
  };
}

/**
 * Sign a built OTA `manifest.json` in place (Ed25519), so the watch will accept
 * the bundle. Reads the manifest's OWN `version` and `bundle` (so the signed
 * bytes can't disagree with what's served), signs
 * `v1:<keyId>:<version>:<bundle.js>`, and writes `signature` + `keyId` back.
 * Run at PUBLISH time, never in a dev build — the private key must never touch
 * one. `keyId` must match a key in the app's `signerPublicKeys` and is bound
 * into the signed bytes (CX-007) so it can't be swapped.
 *
 * @param {{
 *   distDir: string,
 *   keyId: string,
 *   privateKeySeedBase64: string,
 *   manifestFileName?: string,
 * }} opts
 * @returns {{ signature: string, keyId: string, version: number }}
 */
export function signManifest({
  distDir,
  keyId,
  privateKeySeedBase64,
  manifestFileName = "manifest.json",
}) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(keyId ?? "")) {
    throw new Error(
      "keyId must be 1–64 chars of [A-Za-z0-9_-] (no colons) — use the id " +
        "from generateSigningKey()",
    );
  }
  const privateKey = privateKeyFromSeed(privateKeySeedBase64);
  const manifestPath = join(distDir, manifestFileName);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const bundle = readFileSync(join(distDir, manifest.bundle), "utf8");
  const message = Buffer.from(
    `${SIGN_SCHEME}:${keyId}:${manifest.version}:${bundle}`,
    "utf8",
  );
  const signature = sign(null, message, privateKey).toString("base64"); // Ed25519
  manifest.signature = signature;
  manifest.keyId = keyId;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { signature, keyId, version: manifest.version };
}
