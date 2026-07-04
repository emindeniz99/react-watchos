import { spawn } from "node:child_process";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureError,
  captureLog,
  inspectorSnapshot,
  startInspector,
  stopInspector,
} from "../src/index";

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__inspect;
});

describe("inspector snapshot", () => {
  it("includes the tree from __inspect and buffered logs", () => {
    (globalThis as { __inspect?: () => unknown }).__inspect = () => ({
      commits: 3,
      tree: { type: "VStack" },
    });
    captureLog("hello");
    captureLog("world");
    const snap = inspectorSnapshot();
    expect(snap.commits).toBe(3);
    expect(snap.tree).toEqual({ type: "VStack" });
    expect(snap.logs).toContain("hello");
    expect(snap.logs).toContain("world");
  });

  it("records an error's stack and componentStack (ErrorBoundary onError shape)", () => {
    const err = new Error("boom-42");
    captureError(err, {
      componentStack: "\n    at Boom\n    at ErrorBoundary",
    });
    const entry = inspectorSnapshot().errors.find(
      (e) => e.message === "boom-42",
    );
    expect(entry).toBeDefined();
    expect(entry?.stack).toBe(err.stack);
    expect(entry?.componentStack).toContain("Boom");
  });

  it("captures a non-Error value by its string form", () => {
    captureError("plain failure");
    expect(
      inspectorSnapshot().errors.some((e) => e.message === "plain failure"),
    ).toBe(true);
  });
});

describe("inspector server", () => {
  it("accepts a POSTed snapshot and serves it back + the HTML page", async () => {
    const port = 8731;
    const server = spawn(
      "node",
      [join(__dirname, "../scripts/inspector.mjs")],
      {
        env: { ...process.env, INSPECTOR_PORT: String(port) },
        stdio: "ignore",
      },
    );
    try {
      await new Promise((r) => setTimeout(r, 400));
      const base = `http://127.0.0.1:${port}`;
      await fetch(`${base}/snapshot`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          commits: 1,
          tree: { type: "Text" },
          logs: ["x"],
        }),
      });
      const snap = await (await fetch(`${base}/snapshot`)).json();
      expect(snap.tree).toEqual({ type: "Text" });
      expect(snap.logs).toEqual(["x"]);
      const html = await (await fetch(base)).text();
      expect(html).toContain("react-watchos inspector");
    } finally {
      server.kill();
    }
  });
});

// CX-019: an offline inspector server must not produce a rejection every poll
// (the runtime's promise-rejection tracker would turn that into a once-a-second
// dev-overlay banner), and the poll must be stoppable + restartable.
describe("inspector polling (CX-019)", () => {
  it("swallows offline poll errors and supports stop + restart", async () => {
    (globalThis as { __inspect?: () => unknown }).__inspect = () => ({
      commits: 0,
      tree: null,
    });
    // Holder (not a bare `let`) so the closure assignment is visible to TS.
    const captured: { tick?: () => void } = {};
    const clearInterval = vi.fn();
    const fetchUrls: string[] = [];
    vi.stubGlobal("setInterval", (fn: () => void) => {
      captured.tick = fn;
      return 1;
    });
    vi.stubGlobal("clearInterval", clearInterval);
    vi.stubGlobal("fetch", (url: string) => {
      fetchUrls.push(url);
      return Promise.reject(new Error("offline"));
    });
    try {
      const stop = startInspector({ url: "http://a/snapshot", intervalMs: 10 });
      expect(typeof stop).toBe("function");
      captured.tick?.(); // one poll against an offline server
      await Promise.resolve(); // flush — an uncaught rejection would fail the test
      expect(fetchUrls).toEqual(["http://a/snapshot"]);

      stop();
      expect(clearInterval).toHaveBeenCalledTimes(1);

      stopInspector(); // idempotent when already stopped
      const stop2 = startInspector({
        url: "http://b/snapshot",
        intervalMs: 10,
      });
      captured.tick?.();
      await Promise.resolve();
      expect(fetchUrls).toContain("http://b/snapshot");
      stop2();
    } finally {
      vi.unstubAllGlobals();
      delete (globalThis as Record<string, unknown>).__inspect;
    }
  });
});
