// FNV-1a 64-bit content hash, byte-for-byte identical to Swift
// ReactWatchSupport.ContentHash (same offset basis + prime, UInt64 wraparound,
// lowercase hex without leading zeros). The build stamps the OTA manifest's
// `releaseId` with this; the host exposes the loaded bundle's ContentHash as
// `globalThis.__bundleReleaseId`, so JS checkForUpdate can compare them and
// detect a non-breaking fix that kept the same compatibility `version` (CX-025).
// Verified against Swift in content-hash.test (and ContentHash.swift's vectors).

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
