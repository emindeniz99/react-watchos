// OTA manifest helpers for a consumer's build (published as
// `react-native-watchos/manifest`). After you build your watch bundle with the
// preset, call `writeOTAManifest` to stamp the `manifest.json` the watch's
// `checkForUpdate` / `fetchAndApplyUpdate` fetch — so you don't hand-write the
// manifest shape or reverse-engineer the `releaseId` hash. Serve the resulting
// `manifest.json` + bundle from any static host (CDN/S3); sign with `ota:sign`.

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
 * `signature` is left null — fill it at publish time with `ota:sign`.
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
