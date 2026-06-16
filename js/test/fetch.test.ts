import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installShims } from "../src/shims";

// Simulates the bare QuickJS engine (no native fetch): a host that records
// the request, settled the way JSRuntime.swift does via __resolveFetch /
// __rejectFetch.
const g = globalThis as Record<string, unknown>;

describe("fetch shim (QuickJS environment)", () => {
  let savedFetch: unknown;
  let hostFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    savedFetch = g.fetch;
    g.fetch = undefined; // force installShims to install ours
    g.__resolveFetch = undefined;
    g.__rejectFetch = undefined;
    hostFetch = vi.fn();
    g.__host = { fetch: hostFetch, log: () => {} };
    installShims();
  });

  afterEach(() => {
    g.fetch = savedFetch;
    delete g.__host;
    delete g.__resolveFetch;
    delete g.__rejectFetch;
  });

  it("sends the request and resolves a Response via __resolveFetch", async () => {
    const fetch = g.fetch as (url: string, o?: unknown) => Promise<any>;
    const promise = fetch("https://api.test/x", { method: "POST", body: "hi" });

    expect(hostFetch).toHaveBeenCalledTimes(1);
    const [id, reqJson] = hostFetch.mock.calls[0];
    expect(JSON.parse(reqJson)).toMatchObject({
      url: "https://api.test/x",
      method: "POST",
      body: "hi",
    });

    (g.__resolveFetch as (i: number, j: string) => void)(
      id,
      JSON.stringify({ status: 200, body: '{"ok":true}', headers: {} }),
    );
    const res = await promise;
    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ ok: true });
    expect(await res.text()).toBe('{"ok":true}');
  });

  it("rejects via __rejectFetch", async () => {
    const fetch = g.fetch as (url: string) => Promise<unknown>;
    const promise = fetch("https://api.test/y");
    const [id] = hostFetch.mock.calls[0];
    (g.__rejectFetch as (i: number, m: string) => void)(id, "offline");
    await expect(promise).rejects.toThrow("offline");
  });

  it("marks non-2xx responses as not ok", async () => {
    const fetch = g.fetch as (url: string) => Promise<any>;
    const promise = fetch("https://api.test/z");
    const [id] = hostFetch.mock.calls[0];
    (g.__resolveFetch as (i: number, j: string) => void)(
      id,
      JSON.stringify({ status: 404, body: "nope" }),
    );
    const res = await promise;
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
  });
});
