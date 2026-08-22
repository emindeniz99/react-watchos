import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyUpdate,
  BUNDLE_VERSION,
  checkForUpdate,
  fetchAndApplyUpdate,
  getUpdateState,
  markUpdateHealthy,
  Storage,
} from "../src/index";
import { installMockHost } from "./helpers";

const g = globalThis as Record<string, unknown>;

afterEach(() => {
  Storage.clearMemoryFallback(); // the staged-release marker must not leak
  delete g.__host;
  delete g.fetch;
  delete g.__hostFeatures;
  delete g.__bridgeProtocol;
  delete g.__bundleReleaseId;
});

describe("OTA observability (getUpdateState)", () => {
  it("reports the native state merged with the running releaseId", async () => {
    const host = installMockHost();
    host.invoke.mockImplementation((id: number, method: string) => {
      const g = globalThis as {
        __resolveInvoke?: (id: number, resultJson: string) => void;
      };
      if (method === "getUpdateState") {
        g.__resolveInvoke?.(
          id,
          JSON.stringify({
            source: "ota",
            version: 4,
            keyId: "k1",
            highWater: 4,
            healthSignal: "explicit",
            bootAttempts: 2,
          }),
        );
      }
    });
    g.__bundleReleaseId = "abc123";
    // healthSignal + bootAttempts are the ARCH-04 telemetry pair: which policy
    // the BINARY enforces (the bundle can't tell — the anchor is native) and
    // how close this device is to a crash-loop rollback. Reporting them is
    // the only way a fleet dashboard can see "on explicit, one launch left".
    expect(await getUpdateState()).toEqual({
      source: "ota",
      version: 4,
      keyId: "k1",
      highWater: 4,
      healthSignal: "explicit",
      bootAttempts: 2,
      releaseId: "abc123",
    });
  });

  it("degrades to shipped/0 with no invoke-capable host, never rejects", async () => {
    expect(await getUpdateState()).toEqual({
      source: "shipped",
      highWater: 0,
      healthSignal: "commit",
      bootAttempts: 0,
    });
  });
});

describe("explicit health signal (markUpdateHealthy)", () => {
  it("confirms the launch through the ota invoke channel", async () => {
    const host = installMockHost();
    host.invoke.mockImplementation((id: number, method: string) => {
      const resolve = (
        globalThis as {
          __resolveInvoke?: (id: number, resultJson: string) => void;
        }
      ).__resolveInvoke;
      if (method === "markUpdateHealthy") resolve?.(id, "null");
    });
    await expect(markUpdateHealthy()).resolves.toBeUndefined();
    // The bundle must reach the NATIVE counter — a JS-local "we're fine" flag
    // would confirm nothing, since the crash-loop counter it clears lives in
    // App Group storage and survives the process this bundle runs in.
    expect(host.invoke).toHaveBeenCalledWith(
      expect.any(Number),
      "markUpdateHealthy",
      "{}",
    );
  });

  it("resolves silently with no invoke-capable host, never rejects", async () => {
    // A bundle calls this unconditionally after its smoke checks; under a
    // test/Node host (or a binary on the .firstCommit policy) there is nothing
    // counting boots, so throwing here would make apps guard a call that is
    // meant to be fire-and-forget.
    await expect(markUpdateHealthy()).resolves.toBeUndefined();
  });
});

describe("OTA transport policy (https enforcement)", () => {
  it("refuses a public plain-http manifest URL loudly", async () => {
    installMockHost();
    g.fetch = vi.fn();
    await expect(
      checkForUpdate("http://updates.example.com/manifest.json"),
    ).rejects.toThrow(/must be https/);
    await expect(
      fetchAndApplyUpdate("http://updates.example.com/manifest.json"),
    ).rejects.toThrow(/must be https/);
    expect(g.fetch).not.toHaveBeenCalled(); // refused BEFORE any network I/O
  });

  it("allows the documented dev hosts over plain http", async () => {
    installMockHost();
    for (const base of [
      "http://localhost:8788",
      "http://127.0.0.1:8788",
      "http://192.168.1.20",
      "http://172.16.0.2",
      "http://emins-mac.local:8788",
    ]) {
      g.fetch = vi.fn(async () => ({
        json: async () => ({ version: BUNDLE_VERSION, bundle: "bundle.js" }),
      }));
      await expect(
        checkForUpdate(`${base}/manifest.json`),
      ).resolves.toMatchObject({ updateAvailable: false });
    }
  });

  it("allows the IPv6 loopback dev host over plain http", async () => {
    // REGRESSION PIN: the host regex used to stop at the first colon, so
    // `http://[::1]:8080` handed isPrivateHost the bare string "[" and IPv6
    // loopback was never a usable dev host. The PORTED form is the case that
    // triggered the truncation — if it is accepted, the bare-"[" parse bug
    // cannot have returned.
    installMockHost();
    for (const base of [
      "http://[::1]:8080",
      "http://[::1]",
      "http://[0:0:0:0:0:0:0:1]:8788", // uncompressed spelling, same address
    ]) {
      g.fetch = vi.fn(async () => ({
        json: async () => ({ version: BUNDLE_VERSION, bundle: "bundle.js" }),
      }));
      await expect(
        checkForUpdate(`${base}/manifest.json`),
      ).resolves.toMatchObject({ updateAvailable: false });
    }
  });

  it("refuses every non-loopback IPv6 literal (recorded decision: loopback ONLY)", async () => {
    installMockHost();
    for (const base of [
      "http://[::2]:8080", // one past loopback
      "http://[2001:db8::1]", // public
      "http://[fe80::1]", // link-local fe80::/10 — explicitly out of scope
      "http://[febf::1]", // top of the link-local /10
      "http://[fc00::1]", // ULA fc00::/7 — explicitly out of scope
      "http://[fd12:3456::1]", // ULA, fd half of the /7
      "http://[::ffff:7f00:1]", // IPv4-mapped 127.0.0.1 is not ::1
      "http://[::1%25eth0]", // a zone id never names plain loopback
      "http://[::]", // the unspecified address
      "http://[0:0:0:0:0:0:0:0:1]", // 9 groups — not an IPv6 literal at all
    ]) {
      g.fetch = vi.fn();
      // The https message, not "must be absolute": the bracketed host PARSED
      // and the policy refused it — the old bug's failure mode was the parse
      // itself going wrong.
      await expect(checkForUpdate(`${base}/manifest.json`)).rejects.toThrow(
        /must be https/,
      );
      expect(g.fetch).not.toHaveBeenCalled();
    }
  });

  it("refuses a public host merely crafted to start with a private-looking prefix", async () => {
    // `isPrivateHost` used to classify by REGEX PREFIX (`/^10\./`), so a
    // fully-public DNS name that starts "10." — or "192.168." or "172.20." —
    // counted as LAN, allowing cleartext OTA to an attacker-controlled host.
    installMockHost();
    for (const base of [
      "http://10.attacker.com",
      "http://192.168.evil.com",
      "http://172.20.evil.com",
      "http://127.attacker.com",
    ]) {
      g.fetch = vi.fn();
      await expect(checkForUpdate(`${base}/manifest.json`)).rejects.toThrow(
        /must be https/,
      );
      expect(g.fetch).not.toHaveBeenCalled();
    }
  });

  it("refuses a cleartext ABSOLUTE bundle URL riding on an https manifest", async () => {
    installMockHost();
    g.fetch = vi.fn(async () => ({
      json: async () => ({
        version: BUNDLE_VERSION + 1,
        bundle: "http://updates.example.com/bundle.js",
      }),
    }));
    await expect(
      fetchAndApplyUpdate("https://updates.example.com/manifest.json"),
    ).rejects.toThrow(/must be https/);
  });
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

  it("does not re-download a release that is already staged (awaiting relaunch)", async () => {
    // Staged bundles only take effect next launch; without the staged marker
    // every check between apply and relaunch saw the manifest as "fresh" and
    // re-downloaded the same bundle — battery + radio waste on a watch.
    const host = installMockHost();
    const backing = new Map<string, string>();
    host.getItem.mockImplementation((k: string) => backing.get(k) ?? null);
    host.setItem.mockImplementation((k: string, v: string) => {
      backing.set(k, v);
    });
    g.__bundleReleaseId = "aaaa"; // running release
    const manifest = {
      version: BUNDLE_VERSION,
      bundle: "bundle.js",
      releaseId: "bbbb", // the update
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ json: async () => manifest })
      .mockResolvedValueOnce({ text: async () => "globalThis.x=2;" })
      .mockResolvedValue({ json: async () => manifest });
    g.fetch = fetchMock;

    // First apply downloads + stages (2 fetches: manifest + bundle).
    expect(await fetchAndApplyUpdate("https://x.test/manifest.json")).toBe(
      BUNDLE_VERSION,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Still not relaunched: the same release is neither "available"…
    expect(
      (await checkForUpdate("https://x.test/manifest.json")).updateAvailable,
    ).toBe(false);
    // …nor re-downloaded (only the manifest is fetched, not the bundle).
    expect(await fetchAndApplyUpdate("https://x.test/manifest.json")).toBe(
      null,
    );
    expect(fetchMock).toHaveBeenCalledTimes(4); // +2 manifests, no bundle

    // A genuinely NEWER release (different id) still comes through.
    fetchMock.mockResolvedValue({
      json: async () => ({ ...manifest, releaseId: "cccc" }),
    });
    expect(
      (await checkForUpdate("https://x.test/manifest.json")).updateAvailable,
    ).toBe(true);
  });

  it("the staged marker expires, so a rolled-back release isn't suppressed forever", async () => {
    // The suppression edge: stage R, native crash-loop rolls it back, and the
    // crash was ENVIRONMENTAL (later fixed by an OS/binary update the marker
    // can't observe). Without an expiry the same manifest is skipped forever.
    vi.useFakeTimers();
    try {
      const host = installMockHost();
      const backing = new Map<string, string>();
      host.getItem.mockImplementation((k: string) => backing.get(k) ?? null);
      host.setItem.mockImplementation((k: string, v: string) => {
        backing.set(k, v);
      });
      g.__bundleReleaseId = "aaaa";
      const manifest = {
        version: BUNDLE_VERSION,
        bundle: "bundle.js",
        releaseId: "bbbb",
      };
      g.fetch = vi.fn(
        async () =>
          ({
            json: async () => manifest,
            text: async () => "globalThis.x=2;",
          }) as unknown,
      );

      await fetchAndApplyUpdate("https://x.test/manifest.json");
      // Inside the window: suppressed (still awaiting relaunch / rolled back).
      expect(
        (await checkForUpdate("https://x.test/manifest.json")).updateAvailable,
      ).toBe(false);

      // Past the 24h window (never relaunched onto it → it was rolled back):
      // the release becomes offerable again.
      vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
      expect(
        (await checkForUpdate("https://x.test/manifest.json")).updateAvailable,
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
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

  // ARCH-07: the host publishes the EFFECTIVE feature set — HostFeatures
  // filtered by the app's HostPolicy — as __hostFeatures, so the same
  // pre-download gate also refuses policy-restricted bundles with no JS
  // changes. From here "missing" can mean policy-restricted, not only
  // binary-too-old (see checkForUpdate's appUpdateRequired doc).
  it("checkForUpdate reports the gap when the HostPolicy shrank the set", async () => {
    // A watch-class binary whose policy allows storage/widgets but not
    // network: the native set has "network"; the published effective set
    // doesn't.
    g.__hostFeatures = ["core", "haptics", "storage", "widgets"];
    g.__bridgeProtocol = 1;
    g.fetch = vi.fn(async () => ({
      json: async () => ({
        version: 7,
        bundle: "bundle.js",
        requiredFeatures: ["network", "storage"],
      }),
    }));
    expect(await checkForUpdate("https://x.test/manifest.json")).toEqual({
      current: BUNDLE_VERSION,
      latest: 7,
      updateAvailable: false,
      appUpdateRequired: true,
      missingCapabilities: ["network"],
    });
  });

  it("fetchAndApplyUpdate skips the download under a policy-shrunk set", async () => {
    const host = installMockHost();
    g.__hostFeatures = ["core", "haptics", "storage", "widgets"];
    g.__bridgeProtocol = 1;
    g.fetch = vi.fn(async () => ({
      json: async () => ({
        version: 7,
        bundle: "bundle.js",
        requiredFeatures: ["network"],
      }),
    }));
    expect(
      await fetchAndApplyUpdate("https://x.test/manifest.json"),
    ).toBeNull();
    // Only the manifest was fetched; the bundle download never started and
    // nothing was staged.
    expect((g.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    expect(host.invoke).not.toHaveBeenCalled();
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
