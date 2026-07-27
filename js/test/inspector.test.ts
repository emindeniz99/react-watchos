import { spawn } from "node:child_process";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureError,
  captureLog,
  DIAGNOSTIC_EVENT,
  type Diagnostic,
  dispatchNativeEvent,
  inspectorSnapshot,
  startInspector,
  stopInspector,
  unregisterAllNativeListeners,
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
    // Semi-random port so parallel/repeated runs don't collide on a fixed one
    // (the suite's old flake vector, 2026-07-04 review §5.7).
    const port = 20000 + Math.floor(Math.random() * 20000);
    // The server moved into bin/ (shipped in the tarball; `react-watchos
    // inspector` starts it — M11).
    // inspector-server is real TS (.mts); process.execPath = the Node running
    // vitest, --experimental-strip-types runs it on any Node >= 22.6 (no-op on
    // 24+, where stripping is the default).
    const server = spawn(
      process.execPath,
      [
        "--experimental-strip-types",
        join(__dirname, "../bin/inspector-server.mts"),
      ],
      {
        env: { ...process.env, INSPECTOR_PORT: String(port) },
        stdio: "ignore",
      },
    );
    try {
      const base = `http://127.0.0.1:${port}`;
      // Poll readiness instead of a fixed boot sleep (the other half of the
      // flake): a slow CI runner gets up to 5s, a fast machine ~10ms.
      const deadline = Date.now() + 5000;
      for (;;) {
        try {
          await fetch(`${base}/snapshot`);
          break;
        } catch {
          if (Date.now() > deadline) throw new Error("server never came up");
          await new Promise((r) => setTimeout(r, 25));
        }
      }
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

  // ARCH-08 §3.D. The diagnostics tap is a registerNativeListener
  // subscription, so ANY unregisterAllNativeListeners() — a test teardown, or
  // a host-side reset — silently revokes it. When the "already tapped" state
  // was a boolean that latched forever, a restarted inspector never
  // re-subscribed and reported zero diagnostics for the rest of the context's
  // life: the dev tool went quiet exactly when something had gone wrong.
  it("re-subscribes the diagnostics tap after a stop, even if the listener table was cleared", async () => {
    vi.stubGlobal("setInterval", () => 1);
    vi.stubGlobal("clearInterval", () => {});
    vi.stubGlobal("fetch", () => Promise.resolve());
    const diagnostic: Diagnostic = {
      code: "ota.saveRejected",
      severity: "recoverable",
      subsystem: "ota",
      sessionId: "s1",
      target: "watch",
      timestamp: 1,
    };
    try {
      const stop = startInspector({ url: "http://a/snapshot" });
      // Something else nukes the shared listener table — the tap goes with it.
      unregisterAllNativeListeners();
      stop();

      const stop2 = startInspector({ url: "http://a/snapshot" });
      dispatchNativeEvent(
        DIAGNOSTIC_EVENT,
        diagnostic as unknown as Record<string, unknown>,
      );
      expect(
        inspectorSnapshot().diagnostics.some(
          (d) => d.code === "ota.saveRejected",
        ),
      ).toBe(true);
      stop2();
    } finally {
      vi.unstubAllGlobals();
      unregisterAllNativeListeners();
    }
  });
});
