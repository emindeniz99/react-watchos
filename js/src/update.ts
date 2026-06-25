import { getHost } from "./host";

/**
 * Over-the-air UI updates. The dev live-reload (DEBUG) and this production
 * channel share one mechanism: load a JS bundle from storage in preference
 * to the bundled one. Typical flow:
 *
 *   const m = await (await fetch(MANIFEST_URL)).json(); // use https://
 *   const js = await (await fetch(m.bundleUrl)).text();
 *   applyUpdate(js, m.version, m.signature);            // next launch
 *
 * Security (CR-4 / CR-17): an OTA bundle is arbitrary JS that runs with the
 * full host surface, so an unverified one from a compromised origin is
 * in-sandbox RCE. Sign `"v1:<version>:<js>"` with your Ed25519 private key and
 * pass the base64 `signature` + the `version`; the watch verifies it against
 * the public key configured on `ReactWatchRootView(updatePublicKeyBase64:)`
 * before persisting/evaluating. The `version` is a compatibility integer
 * (bump it only on a breaking change); the watch refuses any bundle older than
 * the newest it has applied (anti-rollback), so an old bundle can't run against
 * a newer-schema db. Always fetch over HTTPS. With no key configured the bundle
 * still loads (fail-open) but the native side logs a loud warning.
 *
 * App Store guardrail (2.5.2): OTA bundles may ship fixes and UI changes to
 * *already-reviewed* functionality — not materially new capability, and
 * never new native APIs (those still need a native release + review). The
 * host surface (`__host.*`) is fixed in the native binary, so an OTA bundle
 * can only use capabilities the shipped app already exposes.
 */
export function applyUpdate(
  js: string,
  version?: number,
  signature?: string,
): void {
  getHost()?.saveUpdate?.(JSON.stringify({ js, version, signature }));
}

/** This bundle's OTA compatibility version (CR-17), injected at build from
 *  scripts/config.mjs. Compared against the server manifest's `version`. */
export const BUNDLE_VERSION = Number(process.env.BUNDLE_VERSION ?? "1");

/** The update manifest served by your update endpoint (dist/manifest.json). */
export interface UpdateManifest {
  /** Monotonic compatibility version (bumped only on a breaking change). */
  version: number;
  /** Bundle URL — absolute (https), or relative to the manifest URL. */
  bundle: string;
  /** base64 Ed25519 signature over "v1:<version>:<bundle-js>". */
  signature?: string;
}

function resolveBundleUrl(manifestUrl: string, bundle: string): string {
  if (/^https?:\/\//.test(bundle)) return bundle;
  // Resolve relative to the manifest's directory (no URL() in QuickJS).
  return manifestUrl.replace(/[^/]*$/, "") + bundle;
}

/**
 * Fetches the update manifest and compares its version to this bundle's.
 * Use it to drive an "update available" prompt. Always serve over HTTPS.
 */
export async function checkForUpdate(
  manifestUrl: string,
): Promise<{ current: number; latest: number; updateAvailable: boolean }> {
  const manifest = (await (await fetch(manifestUrl)).json()) as UpdateManifest;
  return {
    current: BUNDLE_VERSION,
    latest: manifest.version,
    updateAvailable: manifest.version > BUNDLE_VERSION,
  };
}

/**
 * Fetches the manifest and, if it's newer than this bundle, downloads the
 * bundle and stages it (applyUpdate). Returns the staged version, or null if
 * already up to date. The staged update takes effect on the next launch.
 */
export async function fetchAndApplyUpdate(
  manifestUrl: string,
): Promise<number | null> {
  const manifest = (await (await fetch(manifestUrl)).json()) as UpdateManifest;
  if (manifest.version <= BUNDLE_VERSION) return null;
  const url = resolveBundleUrl(manifestUrl, manifest.bundle);
  const js = await (await fetch(url)).text();
  applyUpdate(js, manifest.version, manifest.signature);
  return manifest.version;
}
