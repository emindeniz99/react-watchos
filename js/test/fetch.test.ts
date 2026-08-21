import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFetch } from "../src/fetch";
import { Headers } from "../src/index";

// Simulates the bare QuickJS engine (no native fetch/Headers/AbortController):
// installFetch installs ours; a mock host records requests, settled the way
// JSRuntime.swift does via __resolveFetch / __rejectFetch. Driven directly
// rather than through installShims() because these globals are the build-time
// OPTIONAL half of the shim layer — src/install-shims.ts installs them only
// when the bundle declared a network (see the `network` preset option).
const g = globalThis as Record<string, unknown>;
const SAVED = [
  "fetch",
  "Headers",
  "AbortController",
  "AbortSignal",
  "__resolveFetch",
  "__rejectFetch",
] as const;

describe("Headers (case-insensitive)", () => {
  it("looks up regardless of case and appends", () => {
    const h = new Headers({ "Content-Type": "text/plain" });
    expect(h.get("content-type")).toBe("text/plain");
    expect(h.has("CONTENT-TYPE")).toBe(true);
    h.append("X-Tag", "a");
    h.append("x-tag", "b");
    expect(h.get("x-tag")).toBe("a, b");
  });
});

describe("fetch shim (QuickJS environment)", () => {
  let saved: Record<string, unknown>;
  let hostFetch: ReturnType<typeof vi.fn>;
  let hostAbort: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    saved = {};
    for (const k of SAVED) {
      saved[k] = g[k];
      g[k] = undefined;
    }
    hostFetch = vi.fn();
    hostAbort = vi.fn();
    g.__host = { fetch: hostFetch, abortFetch: hostAbort, log: () => {} };
    installFetch(g);
  });

  afterEach(() => {
    for (const k of SAVED) g[k] = saved[k];
    delete g.__host;
  });

  it("sends an uppercased method + headers and resolves a full Response", async () => {
    const fetch = g.fetch as (url: string, o?: unknown) => Promise<any>;
    const promise = fetch("https://api.test/x", {
      method: "post",
      headers: { "Content-Type": "application/json" },
      body: "hi",
    });
    const [id, reqJson] = hostFetch.mock.calls[0];
    const req = JSON.parse(reqJson);
    expect(req.method).toBe("POST");
    expect(req.headers["content-type"]).toBe("application/json");

    (g.__resolveFetch as (i: number, j: string) => void)(
      id,
      JSON.stringify({
        status: 201,
        statusText: "Created",
        url: "https://api.test/x",
        body: '{"ok":true}',
        headers: { "Content-Type": "application/json" },
      }),
    );
    const res = await promise;
    expect(res.status).toBe(201);
    expect(res.statusText).toBe("Created");
    expect(res.ok).toBe(true);
    expect(res.url).toBe("https://api.test/x");
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("rejects network failures with a TypeError", async () => {
    const fetch = g.fetch as (url: string) => Promise<unknown>;
    const promise = fetch("https://api.test/y");
    const [id] = hostFetch.mock.calls[0];
    (g.__rejectFetch as (i: number, m: string) => void)(id, "offline");
    await expect(promise).rejects.toBeInstanceOf(TypeError);
  });

  it("aborts via AbortController with an AbortError and cancels natively", async () => {
    const fetch = g.fetch as (url: string, o?: unknown) => Promise<unknown>;
    const Controller = g.AbortController as new () => {
      signal: unknown;
      abort: () => void;
    };
    const controller = new Controller();
    const promise = fetch("https://slow.test", { signal: controller.signal });
    const [id] = hostFetch.mock.calls[0];

    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(hostAbort).toHaveBeenCalledWith(id);
    // A late response after abort must not throw or double-settle.
    expect(() =>
      (g.__resolveFetch as (i: number, j: string) => void)(
        id,
        JSON.stringify({ status: 200, body: "late" }),
      ),
    ).not.toThrow();
  });

  it("rejects immediately if the signal is already aborted", async () => {
    const fetch = g.fetch as (url: string, o?: unknown) => Promise<unknown>;
    const Controller = g.AbortController as new () => {
      signal: unknown;
      abort: () => void;
    };
    const controller = new Controller();
    controller.abort();
    await expect(
      fetch("https://x.test", { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(hostFetch).not.toHaveBeenCalled();
  });

  it("times out via the timeout sugar", async () => {
    const fetch = g.fetch as (url: string, o?: unknown) => Promise<unknown>;
    const promise = fetch("https://slow.test", { timeout: 5 });
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });

  it("composes signal + timeout — the timeout still fires under a caller signal", async () => {
    // The old code silently DROPPED `timeout` when `signal` was also passed —
    // the caller thought they had a deadline and had none.
    const fetch = g.fetch as (url: string, o?: unknown) => Promise<unknown>;
    const Controller = g.AbortController as new () => {
      signal: unknown;
      abort: () => void;
    };
    const controller = new Controller();
    const promise = fetch("https://slow.test", {
      signal: controller.signal,
      timeout: 5,
    });
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });

  it("composes signal + timeout — the caller abort still wins too", async () => {
    const fetch = g.fetch as (url: string, o?: unknown) => Promise<unknown>;
    const Controller = g.AbortController as new () => {
      signal: unknown;
      abort: (reason?: unknown) => void;
    };
    const controller = new Controller();
    const promise = fetch("https://slow.test", {
      signal: controller.signal,
      timeout: 60_000,
    });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    const [id] = hostFetch.mock.calls[0];
    expect(hostAbort).toHaveBeenCalledWith(id);
  });

  it("arms a default last-resort watchdog when no timeout is given", async () => {
    // fetch was the one async channel with NO bound (invoke=30s, generate=60s);
    // the default watchdog closes the "never hangs" gap. Cleared on settle.
    vi.useFakeTimers();
    try {
      const fetch = g.fetch as (url: string, o?: unknown) => Promise<unknown>;
      const promise = fetch("https://hang.test");
      expect(vi.getTimerCount()).toBe(1); // the 120s watchdog is armed
      vi.advanceTimersByTime(120_000);
      await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("timeout: Infinity opts out of the watchdog", async () => {
    vi.useFakeTimers();
    try {
      const fetch = g.fetch as (url: string, o?: unknown) => Promise<any>;
      const promise = fetch("https://api.test/x", {
        timeout: Number.POSITIVE_INFINITY,
      });
      expect(vi.getTimerCount()).toBe(0); // no watchdog armed
      const [id] = hostFetch.mock.calls[0];
      (g.__resolveFetch as (i: number, j: string) => void)(
        id,
        JSON.stringify({ status: 200, body: "ok" }),
      );
      await expect(promise).resolves.toMatchObject({ status: 200 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels the timeout timer when the response arrives first", async () => {
    // The abort listener is dropped on settle, so a leaked timer fires
    // harmlessly — but on the watch every timer round-trips to the native host,
    // so a settled fetch must not leave one armed. getTimerCount() proves it.
    vi.useFakeTimers();
    try {
      const fetch = g.fetch as (url: string, o?: unknown) => Promise<any>;
      const promise = fetch("https://api.test/fast", { timeout: 50 });
      expect(vi.getTimerCount()).toBe(1); // the timeout timer is armed
      const [id] = hostFetch.mock.calls[0];
      (g.__resolveFetch as (i: number, j: string) => void)(
        id,
        JSON.stringify({ status: 200, body: "ok" }),
      );
      const res = await promise;
      expect(res.status).toBe(200);
      expect(vi.getTimerCount()).toBe(0); // cleared on settle, not left to fire
    } finally {
      vi.useRealTimers();
    }
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

  // CR-6: a binary body used to UTF-8-decode to "" and vanish silently. It now
  // arrives base64-encoded; arrayBuffer() recovers the exact bytes and
  // text()/json() reject loudly instead of returning a wrong value.
  it("exposes a binary body via arrayBuffer and rejects text/json", async () => {
    const fetch = g.fetch as (url: string) => Promise<any>;
    const promise = fetch("https://api.test/blob");
    const [id] = hostFetch.mock.calls[0];
    (g.__resolveFetch as (i: number, j: string) => void)(
      id,
      JSON.stringify({ status: 200, body: "AAEC/w==", bodyEncoding: "base64" }),
    );
    const res = await promise;
    expect(res.bodyEncoding).toBe("base64");
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([
      0, 1, 2, 255,
    ]);
    await expect(res.text()).rejects.toBeInstanceOf(TypeError);
    await expect(res.json()).rejects.toBeInstanceOf(TypeError);
  });

  it("arrayBuffer UTF-8-encodes a text body (multi-byte safe)", async () => {
    const fetch = g.fetch as (url: string) => Promise<any>;
    const promise = fetch("https://api.test/text");
    const [id] = hostFetch.mock.calls[0];
    (g.__resolveFetch as (i: number, j: string) => void)(
      id,
      JSON.stringify({ status: 200, body: "hé" }),
    );
    const res = await promise;
    expect(res.bodyEncoding).toBe("utf8");
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([
      104, 195, 169,
    ]);
  });

  // CX-021: the URL scheme is NOT gatekept in JS. The native FetchPlan +
  // URLSession are the single authority on what can be requested (they accept
  // any absolute URL and reject what they can't fetch). So any scheme — including
  // a custom app scheme — is passed straight through, verbatim, for native to
  // attempt; JS doesn't pre-restrict it.
  it("passes any URL scheme through to the host unchanged", () => {
    const fetch = g.fetch as (url: string) => Promise<unknown>;
    fetch("xapp://hello");
    fetch("HTTPS://api.test/x");
    expect(hostFetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(hostFetch.mock.calls[0][1]).url).toBe("xapp://hello");
    expect(JSON.parse(hostFetch.mock.calls[1][1]).url).toBe(
      "HTTPS://api.test/x",
    );
  });

  // CX-021: a body is consumed once (WHATWG). The first read locks it; a
  // second read rejects with a TypeError, and bodyUsed reflects the state.
  it("consumes the body once (bodyUsed) and rejects a second read", async () => {
    const fetch = g.fetch as (url: string) => Promise<any>;
    const promise = fetch("https://api.test/once");
    const [id] = hostFetch.mock.calls[0];
    (g.__resolveFetch as (i: number, j: string) => void)(
      id,
      JSON.stringify({ status: 200, body: '{"n":1}' }),
    );
    const res = await promise;
    expect(res.bodyUsed).toBe(false);
    expect(await res.json()).toEqual({ n: 1 });
    expect(res.bodyUsed).toBe(true);
    await expect(res.text()).rejects.toBeInstanceOf(TypeError);
    await expect(res.arrayBuffer()).rejects.toBeInstanceOf(TypeError);
  });
});

describe("fetch shim with a host lacking fetch (reduced/widget host)", () => {
  const SHIM = [
    "fetch",
    "Headers",
    "AbortController",
    "AbortSignal",
    "__resolveFetch",
    "__rejectFetch",
  ] as const;
  let saved: Record<string, unknown>;

  beforeEach(() => {
    saved = {};
    for (const k of SHIM) {
      saved[k] = g[k];
      g[k] = undefined;
    }
    // A host without a `fetch` method (widget/test), like installMockHost.
    g.__host = { log: () => {} };
    installFetch(g);
  });

  afterEach(() => {
    for (const k of SHIM) g[k] = saved[k];
    delete g.__host;
  });

  it("rejects instead of hanging when __host.fetch is absent (CX-022)", async () => {
    const fetch = g.fetch as (url: string) => Promise<unknown>;
    // Must settle (reject), not leave a promise pending forever.
    await expect(fetch("https://api.test/x")).rejects.toBeInstanceOf(TypeError);
  });
});
