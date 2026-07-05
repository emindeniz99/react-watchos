import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contentHash, writeOTAManifest } from "../esbuild/manifest.mts";

// CX-025: the build's `releaseId` (JS contentHash) and the host's
// `__bundleReleaseId` (Swift ReactWatchSupport.ContentHash) must be byte-equal
// for the freshness comparison to work, or every check would falsely report an
// update. These vectors were produced by BOTH implementations and match.
describe("contentHash matches Swift ContentHash (CX-025)", () => {
  it("reproduces the known FNV-1a-64 vectors Swift produces", () => {
    expect(contentHash("hello")).toBe("a430d84680aabd0b");
    expect(contentHash("globalThis.__x=42;")).toBe("48f85877cc5dfcc0");
  });

  it("is deterministic and content-sensitive", () => {
    expect(contentHash("a")).toBe(contentHash("a"));
    expect(contentHash("a")).not.toBe(contentHash("b"));
  });
});

// DX (#2): the published manifest helper a consumer's build calls so it doesn't
// reverse-engineer the OTA manifest shape or the releaseId hash.
describe("writeOTAManifest", () => {
  it("stamps a manifest whose releaseId is the bundle's contentHash", () => {
    const dir = mkdtempSync(join(tmpdir(), "rnw-manifest-"));
    const bundle = "globalThis.__x=42;";
    writeFileSync(join(dir, "bundle.js"), bundle);

    const manifest = writeOTAManifest({
      distDir: dir,
      version: 3,
      requiredFeatures: ["storage", "widgets"],
      minBridgeProtocol: 1,
    });

    expect(manifest).toEqual({
      version: 3,
      bundle: "bundle.js",
      signature: null,
      releaseId: contentHash(bundle),
      requiredFeatures: ["storage", "widgets"],
      minBridgeProtocol: 1,
      expiresAt: 0, // signed-expiry default: never (the revocation lever)
    });
    // It was actually written to disk for the static host to serve.
    expect(
      JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")),
    ).toEqual(manifest);
  });
});
