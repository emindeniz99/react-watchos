import { getHost } from "./host";

/**
 * Over-the-air UI updates. The dev live-reload (DEBUG) and this production
 * channel share one mechanism: load a JS bundle from storage in preference
 * to the bundled one. Typical flow:
 *
 *   const res = await fetch(MY_BUNDLE_URL, { ... });      // use https://
 *   if (res.ok) applyUpdate(await res.text(), signature); // next launch
 *
 * Security (CR-4): an OTA bundle is arbitrary JS that runs with the full host
 * surface, so an unverified one from a compromised origin is in-sandbox RCE.
 * Sign the bundle with your Ed25519 private key and pass the base64 signature
 * here; the watch verifies it against the public key configured on
 * `ReactWatchRootView(updatePublicKeyBase64:)` before persisting/evaluating.
 * Always fetch over HTTPS. If the app configures no key the bundle still loads
 * (fail-open) but the native side logs a loud unverified-bundle warning.
 *
 * App Store guardrail (2.5.2): OTA bundles may ship fixes and UI changes to
 * *already-reviewed* functionality — not materially new capability, and
 * never new native APIs (those still need a native release + review). The
 * host surface (`__host.*`) is fixed in the native binary, so an OTA bundle
 * can only use capabilities the shipped app already exposes.
 */
export function applyUpdate(js: string, signature?: string): void {
  getHost()?.saveUpdate?.(JSON.stringify({ js, signature }));
}
