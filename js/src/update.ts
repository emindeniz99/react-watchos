import { type InvokeError, invoke } from "./invoke";
import { Storage } from "./storage";

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
 * in-sandbox RCE. Sign `"v2:<keyId>:<version>:<expiresAt>:<js>"` with your
 * Ed25519 private key and pass the base64 `signature`, the `keyId`, and the
 * `version` (+ optional `expiresAt` — the revocation lever); the
 * watch looks the `keyId` up in the trusted `keyId -> publicKey` map configured
 * on `ReactWatchRootView(ota: OTAConfig(signerPublicKeys:))` and verifies the
 * signature before persisting/evaluating. The `keyId` is bound *inside* the
 * signed bytes (CX-007), so it can't be swapped to steer the watch to a
 * different key, and an unknown `keyId` fails closed — that's what makes key
 * rotation safe. The `version` is a compatibility integer (bump it only on a
 * breaking change); the watch refuses any bundle older than the newest it has
 * applied (anti-rollback), so an old bundle can't run against a newer-schema db.
 * Always fetch over HTTPS. With no key configured, new OTA saves are REFUSED
 * (NF-29 secure default) unless the app explicitly opts into
 * `OTAConfig(allowUnsignedUpdates: true)` for development.
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

/** What the watch is actually running — the OTA observability surface
 *  (fleet telemetry): report these fields to your backend to know each
 *  device's bundle spread and to implement the staleness/freeze monitoring
 *  docs/ota-signing.md recommends. */
export interface UpdateState {
  /** Which bundle booted this launch. */
  source: "ota" | "shipped";
  /** The running OTA record's compatibility version (absent when shipped or
   *  running an unsigned dev bundle). */
  version?: number;
  /** The signing key that shipped the running OTA bundle. */
  keyId?: string;
  /** The running record's signed expiry (epoch seconds; absent/0 = never). */
  expiresAt?: number;
  /** The device's anti-rollback high-water mark. */
  highWater: number;
  /** Content id of the RUNNING bundle (same value as the manifest
   *  `releaseId` for identical bytes) — merged in from the host-injected
   *  `__bundleReleaseId`, so it's present even for the shipped bundle. */
  releaseId?: string;
}

/**
 * Reports which bundle this launch actually booted + the device's OTA state
 * (review §6.11b — observability). Never rejects: with no invoke-capable host
 * (tests/Node) it resolves a bare `{ source: "shipped", highWater: 0 }` so
 * telemetry code can run unconditionally.
 */
export async function getUpdateState(): Promise<UpdateState> {
  let state: UpdateState;
  try {
    state = await invoke<UpdateState>("getUpdateState", {});
  } catch {
    state = { source: "shipped", highWater: 0 };
  }
  const releaseId = currentReleaseId();
  if (releaseId !== null) state.releaseId = releaseId;
  return state;
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
  expiresAt?: number,
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
      expiresAt,
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
 *  scripts/config.ts. Compared against the server manifest's `version`. */
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
  /** base64 Ed25519 signature over
   *  "v2:<keyId>:<version>:<expiresAt>:<bundle-js>". */
  signature?: string;
  /** Opaque id of the signing key (CX-007). Selects the watch's trusted public
   *  key and is bound into the signed bytes; an unknown id fails closed. */
  keyId?: string;
  /** Epoch seconds after which the signature stops verifying on the watch
   *  (bound into the signed bytes — the revocation lever). 0/omitted = never
   *  expires. Set at signing time (`signManifest`/OTA_SIGNING_EXPIRES_DAYS). */
  expiresAt?: number;
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
 * Validates a fetched manifest's shape LOUDLY (NF-32). Without this, a
 * malformed manifest (a string `version`, a missing `bundle`) flowed into
 * numeric compares and read as "up to date" forever — silently disabling
 * updates, which is also what a manifest-freeze attacker wants to look like.
 * Throwing distinguishes "endpoint is broken" from "no update".
 */
export function parseManifest(raw: unknown): UpdateManifest {
  const fail = (what: string): never => {
    throw new Error(`malformed update manifest: ${what}`);
  };
  if (typeof raw !== "object" || raw === null) fail("not a JSON object");
  const m = raw as Record<string, unknown>;
  if (typeof m.version !== "number" || !Number.isFinite(m.version)) {
    fail("`version` must be a finite number");
  }
  if (typeof m.bundle !== "string" || m.bundle.length === 0) {
    fail("`bundle` must be a non-empty string");
  }
  for (const key of ["releaseId", "signature", "keyId"] as const) {
    if (m[key] !== undefined && typeof m[key] !== "string") {
      fail(`\`${key}\` must be a string when present`);
    }
  }
  if (
    m.requiredFeatures !== undefined &&
    !(
      Array.isArray(m.requiredFeatures) &&
      m.requiredFeatures.every((f) => typeof f === "string")
    )
  ) {
    fail("`requiredFeatures` must be an array of strings when present");
  }
  if (
    m.minBridgeProtocol !== undefined &&
    (typeof m.minBridgeProtocol !== "number" ||
      !Number.isInteger(m.minBridgeProtocol))
  ) {
    // A protocol version is a non-negative integer. Reject NaN/Infinity/
    // fractional explicitly: `NaN > host.bridgeProtocol` is always false, so a
    // poisoned value would silently pass the capability gate (capabilityGap).
    fail("`minBridgeProtocol` must be an integer when present");
  }
  if (
    m.expiresAt !== undefined &&
    (typeof m.expiresAt !== "number" || !Number.isInteger(m.expiresAt))
  ) {
    // Same NaN-poisoning posture: the expiry is inside the signed bytes, so a
    // non-integer here would just fail verification later — but fail loudly at
    // the parse boundary like every other field.
    fail("`expiresAt` must be an integer when present");
  }
  return m as unknown as UpdateManifest;
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

/**
 * OTA transport policy (review §6.11c): update URLs must be https. Plain http
 * is allowed ONLY for the documented dev flow — loopback and private-LAN
 * hosts (the plugin's NSAllowsLocalNetworking scope: localhost, 127.x, [::1],
 * 10.x, 192.168.x, 172.16-31.x, and mDNS *.local — "your Mac on the LAN").
 * The Ed25519 signature protects bundle INTEGRITY regardless; this closes the
 * cleartext exposure that remains — manifest metadata privacy and an on-path
 * attacker shaping freeze/suppression responses. Returns the refusal reason,
 * or null when allowed. Mirrored in Swift's UpdateURLPolicy (the native
 * recovery path), pinned by tests on both sides.
 */
function updateURLViolation(url: string): string | null {
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/:?#]*)/i.exec(url);
  const scheme = match?.[1]?.toLowerCase();
  const host = match?.[2]?.toLowerCase();
  if (scheme === undefined || host === undefined) {
    return `update URL must be absolute (https://…): ${url}`;
  }
  if (scheme === "https") return null;
  if (scheme === "http" && isPrivateHost(host)) return null;
  return (
    "update URL must be https — plain http is allowed only for " +
    `localhost/private-LAN dev hosts: ${url}`
  );
}

function isPrivateHost(host: string): boolean {
  if (host === "localhost" || host === "[::1]") return true;
  if (host.endsWith(".local")) return true;
  if (/^(127|10)\./.test(host) || /^192\.168\./.test(host)) return true;
  const octets = /^172\.(\d{1,3})\./.exec(host);
  if (octets) {
    const second = Number(octets[1]);
    return second >= 16 && second <= 31;
  }
  return false;
}

/** The content id of the bundle currently running, exposed by the host as
 *  `globalThis.__bundleReleaseId` (CX-025). null under a test/dev host or an
 *  older binary that doesn't expose it — then freshness falls back to version. */
function currentReleaseId(): string | null {
  const id = (globalThis as { __bundleReleaseId?: unknown }).__bundleReleaseId;
  return typeof id === "string" ? id : null;
}

/** The releaseId last STAGED by fetchAndApplyUpdate (persisted in Storage) —
 *  staged bundles only take effect on the next launch, so without this marker
 *  every check between apply and relaunch would compare against the RUNNING
 *  release, see the manifest as "fresh", and re-download the same bundle
 *  (battery + radio waste on a watch). Cleared implicitly: once the staged
 *  bundle boots, currentReleaseId matches it anyway; if it's rolled back by
 *  the crash-loop guard, suppressing a re-download of that same bundle is
 *  right too — BUT only for a while: the marker expires after 24h so a
 *  rolled-back release isn't suppressed forever when the crash was
 *  environmental and later fixed (an OS or app-binary update the marker
 *  can't observe). A retry that still crash-loops re-stages the marker, so
 *  the worst case is one download per expiry window. */
const STAGED_RELEASE_KEY = "update.stagedReleaseId";
const STAGED_RELEASE_TTL_MS = 24 * 60 * 60 * 1000;

function stagedReleaseId(): string | null {
  const record = Storage.get<{ id: string; at: number }>(STAGED_RELEASE_KEY);
  if (
    typeof record?.id !== "string" ||
    typeof record.at !== "number" ||
    Date.now() - record.at > STAGED_RELEASE_TTL_MS
  ) {
    return null;
  }
  return record.id;
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
  // Already staged and waiting for the next launch — not fresh, don't
  // re-download it on every check between apply and relaunch.
  if (
    manifest.releaseId !== undefined &&
    manifest.releaseId === stagedReleaseId()
  ) {
    return false;
  }
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
  const violation = updateURLViolation(manifestUrl);
  if (violation !== null) throw new Error(violation);
  const manifest = parseManifest(await (await fetch(manifestUrl)).json());
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
  const manifestViolation = updateURLViolation(manifestUrl);
  if (manifestViolation !== null) throw new Error(manifestViolation);
  const manifest = parseManifest(await (await fetch(manifestUrl)).json());
  if (!isFresherRelease(manifest)) return null;
  const host = hostCapabilities();
  if (host && capabilityGap(manifest, host).length > 0) return null;
  const url = resolveBundleUrl(manifestUrl, manifest.bundle);
  // The manifest's `bundle` may be an ABSOLUTE URL pointing anywhere — check
  // it too, or a cleartext bundle URL rides in on an https manifest.
  const bundleViolation = updateURLViolation(url);
  if (bundleViolation !== null) throw new Error(bundleViolation);
  const js = await (await fetch(url)).text();
  const result = await applyUpdate(
    js,
    manifest.version,
    manifest.signature,
    manifest.keyId,
    manifest.requiredFeatures,
    manifest.minBridgeProtocol,
    manifest.expiresAt,
  );
  // Downloaded, but the watch refused it at save (e.g. signature/capability):
  // report not-staged rather than a version that won't take effect.
  if (!result.accepted) return null;
  // Remember what's staged so checks before the relaunch don't re-download it
  // (timestamped: the marker expires after STAGED_RELEASE_TTL_MS).
  if (manifest.releaseId !== undefined) {
    Storage.set(STAGED_RELEASE_KEY, { id: manifest.releaseId, at: Date.now() });
  }
  return manifest.version;
}
