/** FNV-1a 64-bit hex of the UTF-8 bytes — matches Swift ContentHash and the
 *  host's `__bundleReleaseId` (CX-025). */
export function contentHash(str: string): string;

export interface OTAManifest {
  version: number;
  bundle: string;
  signature: string | null;
  releaseId: string;
  requiredFeatures: string[];
  minBridgeProtocol: number;
  /** Epoch seconds after which the signature stops verifying on the watch
   *  (bound into the signed bytes — the revocation lever). 0 = never. */
  expiresAt: number;
}

/** Write `<distDir>/manifest.json` for the bundle, computing `releaseId` from
 *  the bundle bytes. The watch's checkForUpdate/fetchAndApplyUpdate fetch it. */
export function writeOTAManifest(opts: {
  distDir: string;
  bundleFileName?: string;
  version: number;
  requiredFeatures?: string[];
  minBridgeProtocol?: number;
  signature?: string | null;
  /** Epoch seconds; 0 (default) = the signature never expires. */
  expiresAt?: number;
}): OTAManifest;

/** An Ed25519 OTA signing keypair. Keep `privateKeySeedBase64` secret; add
 *  `publicKeyBase64` to the app's `signerPublicKeys` keyed by `keyId`. */
export interface OTASigningKey {
  keyId: string;
  publicKeyBase64: string;
  privateKeySeedBase64: string;
}

/** Generate an Ed25519 keypair + opaque key id for OTA bundle signing. */
export function generateSigningKey(): OTASigningKey;

/** Sign `<distDir>/manifest.json` in place (Ed25519) over
 *  `v2:<keyId>:<version>:<expiresAt>:<bundle.js>` — the exact bytes the watch
 *  verifies. Run at publish time only. `expiresAt` (epoch seconds, 0 = never)
 *  is the revocation lever, bound into the signed bytes so it can't be
 *  stripped. Returns the signature, key id, signed version, and bound expiry. */
export function signManifest(opts: {
  distDir: string;
  keyId: string;
  privateKeySeedBase64: string;
  manifestFileName?: string;
  expiresAt?: number;
}): { signature: string; keyId: string; version: number; expiresAt: number };
