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
});

describe("OTA applyUpdate", () => {
  it("forwards the bundle to the host as a JSON payload", () => {
    const host = installMockHost();
    applyUpdate("globalThis.x = 1;");
    expect(host.saveUpdate).toHaveBeenCalledWith(
      JSON.stringify({ js: "globalThis.x = 1;" }),
    );
  });

  it("carries the version + Ed25519 signature when provided (CR-4/CR-17)", () => {
    const host = installMockHost();
    applyUpdate("globalThis.x = 1;", 4, "c2lnbmF0dXJl");
    expect(host.saveUpdate).toHaveBeenCalledWith(
      JSON.stringify({
        js: "globalThis.x = 1;",
        version: 4,
        signature: "c2lnbmF0dXJl",
      }),
    );
  });

  it("is a no-op without an update-capable host", () => {
    expect(() => applyUpdate("x")).not.toThrow();
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
    expect(host.saveUpdate).toHaveBeenCalledWith(
      JSON.stringify({ js: "globalThis.x=1;", version: 3, signature: "sig" }),
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
    expect(host.saveUpdate).not.toHaveBeenCalled();
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
    expect(host.saveUpdate).not.toHaveBeenCalled();
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
    expect(host.saveUpdate).toHaveBeenCalled();
  });
});
