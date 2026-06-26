import { type InvokeError, invoke } from "./invoke";

/**
 * Over-the-air UI updates. The dev live-reload (DEBUG) and this production
 * channel share one mechanism: load a JS bundle from storage in preference
 * to the bundled one. Typical flow:
 *
 *   const m = await (await fetch(MANIFEST_URL)).json(); // use https://
 *   const js = await (await fetch(m.bundleUrl)).text();
 *   applyUpdate(js, m.version, m.signature, m.keyId);   // next launch
 *
 * Security (CR-4 / CR-17): an OTA bundle is arbitrary JS that runs with the
 * full host surface, so an unverified one from a compromised origin is
 * in-sandbox RCE. Sign `"v1:<keyId>:<version>:<js>"` with your Ed25519 private
 * key and pass the base64 `signature`, the `keyId`, and the `version`; the
 * watch looks the `keyId` up in the trusted `keyId -> publicKey` map configured
 * on `ReactWatchRootView(ota: OTAConfig(signerPublicKeys:))` and verifies the
 * signature before persisting/evaluating. The `keyId` is bound *inside* the
 * signed bytes (CX-007), so it can't be swapped to steer the watch to a
 * different key, and an unknown `keyId` fails closed — that's what makes key
 * rotation safe. The `version` is a compatibility integer (bump it only on a
 * breaking change); the watch refuses any bundle older than the newest it has
 * applied (anti-rollback), so an old bundle can't run against a newer-schema db.
 * Always fetch over HTTPS. With no key configured the bundle still loads
 * (fail-open) but the native side logs a loud warning.
 *
 * App Store guardrail (2.5.2): OTA bundles may ship fixes and UI changes to
 * *already-reviewed* functionality — not materially new capability, and
 * never new native APIs (those still need a native release + review). The
 * host surface (`__host.*`) is fixed in the native binary, so an OTA bundle
 * can only use capabilities the shipped app already exposes.
 */
/** The outcome of an applyUpdate (CX-005). `accepted` is the only field set on
 *  success; a rejection carries a machine code + human message (e.g. a bad
 *  signature, a capability gap, or a write failure on the watch). */
export interface SaveUpdateResult {
  accepted: boolean;
  /** Set when accepted is false. */
  code?: string;
  message?: string;
}

/**
 * Stages an OTA bundle and resolves whether the watch accepted it (CX-005).
 * Resolves (never rejects) with `{ accepted }` — a refusal from the native side
 * (bad signature, capability gap, downgrade, write failure) comes back as
 * `{ accepted: false, code, message }`, and no invoke-capable host (tests/Node)
 * as `{ accepted: false }` too, so the UI can always tell the user why. Routed
 * through the generic invoke channel (SD-1); the native `saveUpdate` handler
 * always *resolves* its invoke with a SaveUpdateResult.
 */
export async function applyUpdate(
  js: string,
  version?: number,
  signature?: string,
  keyId?: string,
  requiredFeatures?: string[],
  minBridgeProtocol?: number,
): Promise<SaveUpdateResult> {
  try {
    // JSON.stringify drops undefined keys, so a call without keyId/capability
    // fields produces the same payload as before.
    return await invoke<SaveUpdateResult>("saveUpdate", {
      js,
      version,
      signature,
      keyId,
      requiredFeatures,
      minBridgeProtocol,
    });
  } catch (error) {
    // invoke only rejects here when there's no host / the native side errored;
    // a normal OTA refusal is a resolved { accepted: false }.
    return {
      accepted: false,
      code: (error as InvokeError).code ?? "INTERNAL",
      message: error instanceof Error ? error.message : "OTA update rejected",
    };
  }
}

/** This bundle's OTA compatibility version (CR-17), injected at build from
 *  scripts/config.mjs. Compared against the server manifest's `version`. */
export const BUNDLE_VERSION = Number(process.env.BUNDLE_VERSION ?? "1");

/** The update manifest served by your update endpoint (dist/manifest.json). */
export interface UpdateManifest {
  /** Monotonic compatibility version — the anti-rollback GATE (bumped only on a
   *  breaking change), not the freshness signal. */
  version: number;
  /** Content id of the bundle (CX-025): the FRESHNESS signal, distinct from
   *  `version`. Lets a non-breaking fix (same version, new content) be detected
   *  as an update. Stamped by the build; matches the host's `__bundleReleaseId`
   *  for the same bytes. */
  releaseId?: string;
  /** Bundle URL — absolute (https), or relative to the manifest URL. */
  bundle: string;
  /** base64 Ed25519 signature over "v1:<keyId>:<version>:<bundle-js>". */
  signature?: string;
  /** Opaque id of the signing key (CX-007). Selects the watch's trusted public
   *  key and is bound into the signed bytes; an unknown id fails closed. */
  keyId?: string;
  /**
   * Capability features the bundle requires (ARCH-01), e.g. ["network",
   * "bluetooth"]. The watch refuses to apply a bundle whose features its binary
   * doesn't provide — OTA can't add native capability, so the user must update
   * the app. Omitted = no capability requirement declared.
   */
  requiredFeatures?: string[];
  /** Minimum host bridge-protocol version the bundle needs (ARCH-01). */
  minBridgeProtocol?: number;
}

/**
 * Capability features the running native binary provides + its bridge protocol,
 * injected at boot by the host (`globalThis.__hostFeatures` / `__bridgeProtocol`,
 * from the generated `HostFeatures`). `null` when the native side hasn't exposed
 * them (an older binary, or under a test/dev host) — then the capability gate is
 * skipped rather than blocking everything.
 */
function hostCapabilities(): {
  features: string[];
  bridgeProtocol: number;
} | null {
  const g = globalThis as {
    __hostFeatures?: unknown;
    __bridgeProtocol?: unknown;
  };
  if (!Array.isArray(g.__hostFeatures)) return null;
  return {
    features: g.__hostFeatures.filter(
      (f): f is string => typeof f === "string",
    ),
    bridgeProtocol:
      typeof g.__bridgeProtocol === "number" ? g.__bridgeProtocol : 0,
  };
}

/** The required capabilities a manifest declares that `host` doesn't provide
 *  (a bridge-protocol shortfall included as a marker). Empty = runs here. */
function capabilityGap(
  manifest: UpdateManifest,
  host: { features: string[]; bridgeProtocol: number },
): string[] {
  const missing = (manifest.requiredFeatures ?? []).filter(
    (f) => !host.features.includes(f),
  );
  const minBp = manifest.minBridgeProtocol ?? 0;
  if (minBp > host.bridgeProtocol) missing.push(`bridgeProtocol>=${minBp}`);
  return missing;
}

function resolveBundleUrl(manifestUrl: string, bundle: string): string {
  if (/^https?:\/\//.test(bundle)) return bundle;
  // Resolve relative to the manifest's directory (no URL() in QuickJS).
  return manifestUrl.replace(/[^/]*$/, "") + bundle;
}

/** The content id of the bundle currently running, exposed by the host as
 *  `globalThis.__bundleReleaseId` (CX-025). null under a test/dev host or an
 *  older binary that doesn't expose it — then freshness falls back to version. */
function currentReleaseId(): string | null {
  const id = (globalThis as { __bundleReleaseId?: unknown }).__bundleReleaseId;
  return typeof id === "string" ? id : null;
}

/**
 * Whether the manifest's bundle is a newer release than the one running
 * (CX-025) — the FRESHNESS check, decoupled from the rollback gate. A higher
 * `version` is always newer; a lower one is a downgrade (never "available").
 * At the SAME `version`, a differing `releaseId` means a non-breaking fix is
 * available — the case the old version-only check could never ship. Falls back
 * to the version compare when releaseId isn't exposed on both sides.
 */
function isFresherRelease(manifest: UpdateManifest): boolean {
  if (manifest.version > BUNDLE_VERSION) return true;
  if (manifest.version < BUNDLE_VERSION) return false;
  const current = currentReleaseId();
  return (
    manifest.releaseId !== undefined &&
    current !== null &&
    manifest.releaseId !== current
  );
}

/**
 * Fetches the update manifest and reports whether a newer release is available.
 * Freshness keys on the bundle's `releaseId` (CX-025), so a non-breaking fix
 * with the same compatibility `version` is detected too; a version downgrade is
 * never reported. Use it to drive an "update available" prompt. Always HTTPS.
 *
 * If the manifest declares `requiredFeatures`/`minBridgeProtocol` that this
 * binary doesn't provide (ARCH-01), the update can't be applied over the air —
 * the result reports `appUpdateRequired` + `missingCapabilities` (and
 * `updateAvailable` is false) so the UI can prompt an App Store update instead.
 */
export async function checkForUpdate(manifestUrl: string): Promise<{
  current: number;
  latest: number;
  updateAvailable: boolean;
  appUpdateRequired?: boolean;
  missingCapabilities?: string[];
}> {
  const manifest = (await (await fetch(manifestUrl)).json()) as UpdateManifest;
  const isNewer = isFresherRelease(manifest);
  const host = hostCapabilities();
  const missing = isNewer && host ? capabilityGap(manifest, host) : [];
  const appUpdateRequired = missing.length > 0;
  return {
    current: BUNDLE_VERSION,
    latest: manifest.version,
    updateAvailable: isNewer && !appUpdateRequired,
    ...(appUpdateRequired
      ? { appUpdateRequired: true, missingCapabilities: missing }
      : {}),
  };
}

/**
 * Fetches the manifest and, if it's a fresher release than this bundle
 * (`releaseId`/version, CX-025), downloads the bundle and stages it
 * (applyUpdate). Returns the staged version, or null if already up to date —
 * or if the bundle needs a capability this binary lacks
 * (ARCH-01), in which case it's NOT downloaded (the app must be updated; use
 * checkForUpdate to surface that). The staged update takes effect next launch.
 */
export async function fetchAndApplyUpdate(
  manifestUrl: string,
): Promise<number | null> {
  const manifest = (await (await fetch(manifestUrl)).json()) as UpdateManifest;
  if (!isFresherRelease(manifest)) return null;
  const host = hostCapabilities();
  if (host && capabilityGap(manifest, host).length > 0) return null;
  const url = resolveBundleUrl(manifestUrl, manifest.bundle);
  const js = await (await fetch(url)).text();
  const result = await applyUpdate(
    js,
    manifest.version,
    manifest.signature,
    manifest.keyId,
    manifest.requiredFeatures,
    manifest.minBridgeProtocol,
  );
  // Downloaded, but the watch refused it at save (e.g. signature/capability):
  // report not-staged rather than a version that won't take effect.
  return result.accepted ? manifest.version : null;
}
