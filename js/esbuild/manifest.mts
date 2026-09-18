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
// ReactWatchSupport.ContentHash and tools/qjs-compile's fnv1a (same offset
// basis + prime, UInt64 wraparound, lowercase hex without leading zeros). The
// host exposes the loaded bundle's ContentHash as `globalThis.__bundleReleaseId`,
// so JS `checkForUpdate` can compare it to the manifest's `releaseId` and
// detect a non-breaking fix that kept the same compatibility `version`
// (CX-025). All three implementations assert the shared vector file
// Fixtures/content-hash-vectors.json — see content-hash-parity.test.ts.
const OFFSET = 0xcbf29ce484222325n;
const PRIME = 0x100000001b3n;
const MASK = 0xffffffffffffffffn;

/** FNV-1a 64-bit of a string's UTF-8 bytes, hex. */
export function contentHash(str: string): string {
  let hash = OFFSET;
  for (const byte of Buffer.from(str, "utf8")) {
    hash ^= BigInt(byte);
    hash = (hash * PRIME) & MASK;
  }
  return hash.toString(16);
}

/** The OTA `manifest.json` shape the watch fetches and verifies. */
export interface OTAManifest {
  version: number;
  bundle: string;
  signature: string | null;
  releaseId: string;
  requiredFeatures: string[];
  minBridgeProtocol: number;
  expiresAt: number;
  keyId?: string;
  /** Publish sequence bound into the signed bytes; present only once signed
   *  (set by {@link signManifest}, never by the build). */
  sequence?: number;
}

/** Options for {@link writeOTAManifest}. */
export interface WriteOTAManifestOptions {
  distDir: string;
  bundleFileName?: string;
  version: number;
  requiredFeatures?: string[];
  minBridgeProtocol?: number;
  signature?: string | null;
  expiresAt?: number;
}

/**
 * Write the OTA `manifest.json` next to the built bundle, computing `releaseId`
 * (the freshness signal) from the bundle bytes. `version` is the anti-rollback
 * compatibility integer (bump only on a breaking change); `requiredFeatures` /
 * `minBridgeProtocol` are the capability contract the watch gates on (ARCH-01/02).
 * `signature` is left null — fill it at publish time with {@link signManifest}.
 */
export function writeOTAManifest({
  distDir,
  bundleFileName = "bundle.js",
  version,
  requiredFeatures = [],
  minBridgeProtocol = 1,
  signature = null,
  // Epoch SECONDS after which the signature stops verifying on the watch
  // (the revocation lever); 0 = never expires. Bound into the signed bytes.
  expiresAt = 0,
}: WriteOTAManifestOptions): OTAManifest {
  const releaseId = contentHash(
    readFileSync(join(distDir, bundleFileName), "utf8"),
  );
  const manifest: OTAManifest = {
    version,
    bundle: bundleFileName,
    signature,
    releaseId,
    requiredFeatures,
    minBridgeProtocol,
    expiresAt,
  };
  writeFileSync(
    join(distDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

// The signing scheme prefix, in lockstep with Swift's UpdatePlan.scheme. The
// signed message is
// `<scheme>:<keyId>:<version>:<sequence>:<expiresAt>:<bundle.js>` — exactly
// the bytes ReactWatchSupport.UpdatePlan.signedMessage rebuilds and CryptoKit
// verifies (pinned by OTASigningInteropTests). Single-sourced here so the
// published signer and the watch's verifier can't drift. v2 bound an expiry
// (epoch seconds, 0 = never) — the revocation lever. v3 adds the publish
// `sequence` between version and expiresAt: at the same compatibility
// `version` nothing in the v2 bytes was ordered, so whoever answered the
// manifest URL could re-serve an earlier signed build; the watch now keeps
// the highest sequence it has accepted and refuses anything lower.
const SIGN_SCHEME = "v3";

/** Largest publish `sequence` the signer accepts: Int32.max, the width of
 *  Swift `Int` on arm64_32 (every supported watch before S9). Epoch-second
 *  defaults fit until 2038, the same bound `expiresAt` already carries. */
export const MAX_SEQUENCE = 0x7fff_ffff;

// A raw 32-byte Ed25519 seed wrapped in the fixed PKCS#8 prefix (RFC 8410), so
// Node imports it without the public half.
function privateKeyFromSeed(seedBase64: string) {
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

/** An Ed25519 OTA signing keypair (see {@link generateSigningKey}). */
export interface SigningKey {
  keyId: string;
  publicKeyBase64: string;
  privateKeySeedBase64: string;
}

/**
 * Generate an Ed25519 keypair for OTA signing (CR-4 / CR-17). The returned
 * `publicKeyBase64` is the trusted key the watch verifies against — add it to
 * `OTAConfig.signerPublicKeys` keyed by `keyId`. Keep `privateKeySeedBase64`
 * SECRET (a CI secret, e.g. `OTA_SIGNING_KEY`); it's the only thing that lets
 * you ship a bundle the watch will run. `keyId` is an opaque, colon-free name
 * (it carries no key material) so a key can be rotated/revoked cleanly.
 */
export function generateSigningKey(): SigningKey {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  // JWK exposes the raw 32-byte values (x = public, d = private seed) base64url.
  const toBase64 = (b64url: string) =>
    Buffer.from(b64url, "base64url").toString("base64");
  const pub = publicKey.export({ format: "jwk" });
  const priv = privateKey.export({ format: "jwk" });
  if (!pub.x || !priv.d) {
    throw new Error("ed25519 JWK export missing x/d");
  }
  return {
    keyId: randomBytes(6).toString("base64url"),
    publicKeyBase64: toBase64(pub.x),
    privateKeySeedBase64: toBase64(priv.d),
  };
}

/** Options for {@link signManifest}. */
export interface SignManifestOptions {
  distDir: string;
  keyId: string;
  privateKeySeedBase64: string;
  manifestFileName?: string;
  expiresAt?: number;
  /** Publish sequence to bind: a positive integer up to 2^31-1 (Swift `Int`
   *  is 32-bit on arm64_32 watches), e.g. a CI build number — GitHub's
   *  `run_number`, not `run_id`. Default: the signing time in epoch seconds.
   *  Pick one of the two per fleet: a timestamp publish outranks every build
   *  number that could follow it. */
  sequence?: number;
}

/** What {@link signManifest} committed to the signed bytes. */
export interface SignManifestResult {
  signature: string;
  keyId: string;
  version: number;
  sequence: number;
  expiresAt: number;
}

/**
 * Sign a built OTA `manifest.json` in place (Ed25519), so the watch will accept
 * the bundle. Reads the manifest's OWN `version` and `bundle` (so the signed
 * bytes can't disagree with what's served), signs
 * `v3:<keyId>:<version>:<sequence>:<expiresAt>:<bundle.js>`, and writes
 * `signature` + `keyId` + `sequence` (+ `expiresAt` when given here) back.
 * Run at PUBLISH time, never in a dev build — the private key must never
 * touch one. `keyId` must match a key in the app's `signerPublicKeys` and is
 * bound into the signed bytes (CX-007) so it can't be swapped; `expiresAt`
 * (epoch seconds, 0 = never) is bound too, so an expiry can't be stripped
 * off a signed bundle. `sequence` orders publishes at the same `version`:
 * the watch persists the highest it has accepted and refuses a lower one, so
 * a re-served earlier build is not installed. It defaults to the signing
 * time (epoch seconds); every signing is a new publish, so re-signing an
 * older bundle is how you roll back — re-serving its old manifest is not.
 */
export function signManifest({
  distDir,
  keyId,
  privateKeySeedBase64,
  manifestFileName = "manifest.json",
  expiresAt,
  sequence,
}: SignManifestOptions): SignManifestResult {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(keyId ?? "")) {
    throw new Error(
      "keyId must be 1–64 chars of [A-Za-z0-9_-] (no colons) — use the id " +
        "from generateSigningKey()",
    );
  }
  const privateKey = privateKeyFromSeed(privateKeySeedBase64);
  const manifestPath = join(distDir, manifestFileName);
  const manifest = JSON.parse(
    readFileSync(manifestPath, "utf8"),
  ) as OTAManifest;
  const bundle = readFileSync(join(distDir, manifest.bundle), "utf8");
  // The expiry the signature commits to: an explicit option wins, else the
  // manifest's own value, else "never". Integer-coerced so the signed string
  // is canonical.
  const boundExpiresAt = Math.trunc(expiresAt ?? manifest.expiresAt ?? 0);
  // Deliberately `?? now`, never `?? manifest.sequence`: re-signing is a new
  // publish and must take a fresh place in the order. Validated, not
  // truncated — a fractional or non-positive value is a caller bug. Capped at
  // Int32.max: pre-S9 watches are arm64_32, where Swift `Int` is 32-bit and a
  // larger value fails the whole payload decode with a misleading reason.
  const boundSequence = sequence ?? Math.trunc(Date.now() / 1000);
  if (
    !Number.isSafeInteger(boundSequence) ||
    boundSequence < 1 ||
    boundSequence > MAX_SEQUENCE
  ) {
    throw new Error(
      `sequence must be an integer in 1..${MAX_SEQUENCE} (default: signing ` +
        "time in epoch seconds) — it is bound into the signed bytes and the " +
        "watch refuses anything below the highest it has accepted",
    );
  }
  const message = Buffer.from(
    `${SIGN_SCHEME}:${keyId}:${manifest.version}:${boundSequence}:${boundExpiresAt}:${bundle}`,
    "utf8",
  );
  const signature = sign(null, message, privateKey).toString("base64"); // Ed25519
  manifest.signature = signature;
  manifest.keyId = keyId;
  manifest.sequence = boundSequence;
  manifest.expiresAt = boundExpiresAt;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    signature,
    keyId,
    version: manifest.version,
    sequence: boundSequence,
    expiresAt: boundExpiresAt,
  };
}
