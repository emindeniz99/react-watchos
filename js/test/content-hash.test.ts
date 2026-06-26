import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs build helper, no types
import { contentHash } from "../scripts/contentHash.mjs";

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
