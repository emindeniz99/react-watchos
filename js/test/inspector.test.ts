import { spawn } from "node:child_process";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captureLog, inspectorSnapshot } from "../src/index";

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
});

describe("inspector server", () => {
  it("accepts a POSTed snapshot and serves it back + the HTML page", async () => {
    const port = 8731;
    const server = spawn("node", [join(__dirname, "../scripts/inspector.mjs")], {
      env: { ...process.env, INSPECTOR_PORT: String(port) },
      stdio: "ignore",
    });
    try {
      await new Promise((r) => setTimeout(r, 400));
      const base = `http://127.0.0.1:${port}`;
      await fetch(`${base}/snapshot`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commits: 1, tree: { type: "Text" }, logs: ["x"] }),
      });
      const snap = await (await fetch(`${base}/snapshot`)).json();
      expect(snap.tree).toEqual({ type: "Text" });
      expect(snap.logs).toEqual(["x"]);
      const html = await (await fetch(base)).text();
      expect(html).toContain("react-native-watchos inspector");
    } finally {
      server.kill();
    }
  });
});
