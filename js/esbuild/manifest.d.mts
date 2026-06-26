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
}): OTAManifest;
