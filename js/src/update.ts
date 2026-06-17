import { getHost } from "./host";

/**
 * Over-the-air UI updates. The dev live-reload (DEBUG) and this production
 * channel share one mechanism: load a JS bundle from storage in preference
 * to the bundled one. Typical flow:
 *
 *   const res = await fetch(MY_BUNDLE_URL);
 *   if (res.ok) applyUpdate(await res.text()); // takes effect next launch
 *
 * App Store guardrail (2.5.2): OTA bundles may ship fixes and UI changes to
 * *already-reviewed* functionality — not materially new capability, and
 * never new native APIs (those still need a native release + review). The
 * host surface (`__host.*`) is fixed in the native binary, so an OTA bundle
 * can only use capabilities the shipped app already exposes.
 */
export function applyUpdate(js: string): void {
  getHost()?.saveUpdate?.(js);
}
