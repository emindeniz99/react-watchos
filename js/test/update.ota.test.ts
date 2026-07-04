import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyUpdate,
  BUNDLE_VERSION,
  checkForUpdate,
  fetchAndApplyUpdate,
} from "../src/index";
import { installMockHost } from "./helpers";

const g = globalThis as Record<string, unknown>;

afterEach(() => {
  delete g.__host;
  delete g.fetch;
  delete g.__hostFeatures;
  delete g.__bridgeProtocol;
  delete g.__bundleReleaseId;
});

describe("OTA applyUpdate", () => {
  it("forwards the bundle through invoke and resolves accepted", async () => {
    const host = installMockHost();
    const result = await applyUpdate("globalThis.x = 1;");
    expect(host.invoke).toHaveBeenCalledWith(
      expect.any(Number),
      "saveUpdate",
      JSON.stringify({ js: "globalThis.x = 1;" }),
    );
    expect(result).toEqual({ accepted: true });
  });

  it("carries the version + Ed25519 signature + keyId when provided (CR-4/CR-17/CX-007)", async () => {
    const host = installMockHost();
    await applyUpdate("globalThis.x = 1;", 4, "c2lnbmF0dXJl", "k1A2b3C4");
    expect(host.invoke).toHaveBeenCalledWith(
      expect.any(Number),
      "saveUpdate",
      JSON.stringify({
        js: "globalThis.x = 1;",
        version: 4,
        signature: "c2lnbmF0dXJl",
        keyId: "k1A2b3C4",
      }),
    );
  });

  // CX-005: a watch-side refusal (bad signature, capability gap, downgrade,
  // write failure) comes back as a *resolved* { accepted: false } with the
  // native reason — the saveUpdate invoke resolves it, it doesn't reject.
  it("resolves the native refusal reason instead of vanishing", async () => {
    const host = installMockHost();
    host.invoke.mockImplementation((id: number) => {
      (
        globalThis as {
          __resolveInvoke?: (id: number, resultJson: string) => void;
        }
      ).__resolveInvoke?.(
        id,
        JSON.stringify({
          accepted: false,
          code: "bad-signature",
          message: "signature invalid",
        }),
      );
    });
    expect(await applyUpdate("x", 2, "sig")).toEqual({
      accepted: false,
      code: "bad-signature",
      message: "signature invalid",
    });
  });

  it("resolves accepted:false without an invoke-capable host", async () => {
    const result = await applyUpdate("x");
    expect(result.accepted).toBe(false);
    expect(result.code).toBe("UNAVAILABLE");
  });
});

// CR-17: the remote freshness check compares the server manifest's version to
// this bundle's BUNDLE_VERSION (1 in tests, no build-time injection).
describe("OTA freshness check", () => {
  it("checkForUpdate flags a newer manifest version", async () => {
    g.fetch = vi.fn(async () => ({
      json: async () => ({ version: 5, bundle: "bundle.js" }),
    }));
    expect(await checkForUpdate("https://x.test/manifest.json")).toEqual({
      current: BUNDLE_VERSION,
      latest: 5,
      updateAvailable: true,
    });
  });

  it("fetchAndApplyUpdate stages a newer bundle (resolving a relative URL)", async () => {
    const host = installMockHost();
    g.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({
          version: 3,
          bundle: "bundle.js",
          signature: "sig",
          keyId: "k1A2b3C4",
        }),
      })
      .mockResolvedValueOnce({ text: async () => "globalThis.x=1;" });

    const staged = await fetchAndApplyUpdate(
      "https://x.test/sub/manifest.json",
    );
    expect(staged).toBe(3);
    // bundle URL resolved relative to the manifest's directory.
    expect((g.fetch as ReturnType<typeof vi.fn>).mock.calls[1][0]).toBe(
      "https://x.test/sub/bundle.js",
    );
    // The manifest's keyId threads through to the saveUpdate payload (CX-007).
    expect(host.invoke).toHaveBeenCalledWith(
      expect.any(Number),
      "saveUpdate",
      JSON.stringify({
        js: "globalThis.x=1;",
        version: 3,
        signature: "sig",
        keyId: "k1A2b3C4",
      }),
    );
  });

  it("fetchAndApplyUpdate is a no-op when not newer", async () => {
    const host = installMockHost();
    g.fetch = vi.fn(async () => ({
      json: async () => ({ version: BUNDLE_VERSION, bundle: "bundle.js" }),
    }));
    expect(
      await fetchAndApplyUpdate("https://x.test/manifest.json"),
    ).toBeNull();
    expect(host.invoke).not.toHaveBeenCalled();
  });
});

// CX-025: freshness keys on releaseId (a content id), distinct from the
// anti-rollback `version` gate — so a non-breaking fix that kept the same
// version still ships, and a downgrade never reports "available".
describe("OTA freshness by releaseId (CX-025)", () => {
  it("flags a same-version bundle with a different releaseId as available", async () => {
    g.__bundleReleaseId = "aaaa"; // the running bundle's content id
    g.fetch = vi.fn(async () => ({
      json: async () => ({
        version: BUNDLE_VERSION,
        bundle: "bundle.js",
        releaseId: "bbbb", // server published new content, same version
      }),
    }));
    expect(await checkForUpdate("https://x.test/manifest.json")).toEqual({
      current: BUNDLE_VERSION,
      latest: BUNDLE_VERSION,
      updateAvailable: true,
    });
  });

  it("reports no update when the releaseId matches (already running it)", async () => {
    g.__bundleReleaseId = "aaaa";
    g.fetch = vi.fn(async () => ({
      json: async () => ({
        version: BUNDLE_VERSION,
        bundle: "bundle.js",
        releaseId: "aaaa",
      }),
    }));
    expect(
      (await checkForUpdate("https://x.test/manifest.json")).updateAvailable,
    ).toBe(false);
  });

  it("never reports a version downgrade as available, even with a new releaseId", async () => {
    g.__bundleReleaseId = "aaaa";
    g.fetch = vi.fn(async () => ({
      json: async () => ({
        version: BUNDLE_VERSION - 1, // older
        bundle: "bundle.js",
        releaseId: "zzzz",
      }),
    }));
    expect(
      (await checkForUpdate("https://x.test/manifest.json")).updateAvailable,
    ).toBe(false);
  });

  it("fetchAndApplyUpdate stages a same-version releaseId fix", async () => {
    const host = installMockHost();
    g.__bundleReleaseId = "aaaa";
    g.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({
          version: BUNDLE_VERSION,
          bundle: "bundle.js",
          releaseId: "bbbb",
        }),
      })
      .mockResolvedValueOnce({ text: async () => "globalThis.x=2;" });
    expect(await fetchAndApplyUpdate("https://x.test/manifest.json")).toBe(
      BUNDLE_VERSION,
    );
    expect(host.invoke).toHaveBeenCalled();
  });
});

// ARCH-01: a bundle that needs a native capability this binary lacks can't be
// applied over the air (OTA can't add native code) — gate it BEFORE download
// and tell the UI to prompt an app update instead of crashing later.
describe("OTA capability gate", () => {
  it("checkForUpdate flags appUpdateRequired for a missing feature", async () => {
    g.__hostFeatures = ["core", "storage", "widgets"]; // a widget-class surface
    g.__bridgeProtocol = 1;
    g.fetch = vi.fn(async () => ({
      json: async () => ({
        version: 5,
        bundle: "bundle.js",
        requiredFeatures: ["network"],
      }),
    }));
    expect(await checkForUpdate("https://x.test/manifest.json")).toEqual({
      current: BUNDLE_VERSION,
      latest: 5,
      updateAvailable: false,
      appUpdateRequired: true,
      missingCapabilities: ["network"],
    });
  });

  it("fetchAndApplyUpdate refuses to download a bundle this binary can't run", async () => {
    const host = installMockHost();
    g.__hostFeatures = ["core", "storage", "widgets"];
    g.__bridgeProtocol = 1;
    g.fetch = vi.fn(async () => ({
      json: async () => ({
        version: 5,
        bundle: "bundle.js",
        requiredFeatures: ["network"],
      }),
    }));
    expect(
      await fetchAndApplyUpdate("https://x.test/manifest.json"),
    ).toBeNull();
    // Only the manifest was fetched — the bundle itself was never downloaded.
    expect((g.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    expect(host.invoke).not.toHaveBeenCalled();
  });

  it("applies when the binary provides every required feature", async () => {
    const host = installMockHost();
    g.__hostFeatures = ["core", "storage", "network", "widgets"];
    g.__bridgeProtocol = 1;
    g.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({
          version: 6,
          bundle: "bundle.js",
          requiredFeatures: ["network", "storage"],
        }),
      })
      .mockResolvedValueOnce({ text: async () => "globalThis.x=1;" });
    expect(await fetchAndApplyUpdate("https://x.test/manifest.json")).toBe(6);
    expect(host.invoke).toHaveBeenCalled();
  });
});

describe("manifest shape validation (NF-32)", () => {
  it("throws loudly on a malformed manifest instead of reporting up to date", async () => {
    // A string `version` used to flow into numeric compares and read as
    // "up to date" forever — indistinguishable from a freeze attack.
    g.fetch = vi.fn(async () => ({
      json: async () => ({ version: "2", bundle: "bundle.js" }),
    }));
    await expect(
      checkForUpdate("https://x.test/manifest.json"),
    ).rejects.toThrow(/malformed update manifest.*version/);
  });

  it("throws when `bundle` is missing", async () => {
    g.fetch = vi.fn(async () => ({ json: async () => ({ version: 2 }) }));
    await expect(
      fetchAndApplyUpdate("https://x.test/manifest.json"),
    ).rejects.toThrow(/malformed update manifest.*bundle/);
  });

  it("throws when the manifest is not an object", async () => {
    g.fetch = vi.fn(async () => ({ json: async () => "nope" }));
    await expect(
      checkForUpdate("https://x.test/manifest.json"),
    ).rejects.toThrow(/not a JSON object/);
  });

  it("rejects mistyped optional fields", async () => {
    g.fetch = vi.fn(async () => ({
      json: async () => ({
        version: 2,
        bundle: "bundle.js",
        requiredFeatures: "network",
      }),
    }));
    await expect(
      checkForUpdate("https://x.test/manifest.json"),
    ).rejects.toThrow(/requiredFeatures/);
  });

  it("rejects a non-integer minBridgeProtocol (gate-bypass guard)", async () => {
    // NaN/Infinity/fractional would pass a bare `typeof number` check, and
    // `NaN > host.bridgeProtocol` is always false — silently clearing the
    // capability gate. It must fail closed as malformed instead.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      g.fetch = vi.fn(async () => ({
        json: async () => ({
          version: 2,
          bundle: "bundle.js",
          minBridgeProtocol: bad,
        }),
      }));
      await expect(
        checkForUpdate("https://x.test/manifest.json"),
      ).rejects.toThrow(/minBridgeProtocol/);
    }
  });

  it("accepts a fully-populated valid manifest", async () => {
    g.fetch = vi.fn(async () => ({
      json: async () => ({
        version: 2,
        bundle: "bundle.js",
        releaseId: "abc",
        signature: "sig",
        keyId: "kid",
        requiredFeatures: ["network"],
        minBridgeProtocol: 1,
      }),
    }));
    const result = await checkForUpdate("https://x.test/manifest.json");
    expect(result.latest).toBe(2);
  });
});
