import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Runs the real production bundle inside a real QuickJS interpreter
 * (`qjs`), with a JS mock of the `__host` global that mirrors what
 * JSRuntime.swift installs. This is the engine-compatibility gate: if it
 * passes here, the same bundle runs in quickjs-ng on the watch.
 */

const jsRoot = join(__dirname, "..");
const bundlePath = join(jsRoot, "dist/bundle.js");

const harnessPrelude = `
"use strict";
const __commits = [];
const __logs = [];
const __armedTimers = [];
globalThis.__host = {
  commit: (json) => { __commits.push(json); },
  log: (message) => { __logs.push(String(message)); },
  setTimer: (id, ms) => { __armedTimers.push(id); },
  clearTimer: (id) => {
    const i = __armedTimers.indexOf(id);
    if (i >= 0) __armedTimers.splice(i, 1);
  },
};
`;

const harnessEpilogue = `
// Drain timers the way JSRuntime.swift would (scheduler housekeeping).
for (let i = 0; i < 100 && __armedTimers.length > 0; i++) {
  globalThis.__fireTimer(__armedTimers.shift());
}

function findAll(node, type, out = []) {
  if (node.type === type) out.push(node);
  for (const child of node.children) findAll(child, type, out);
  return out;
}

const initial = JSON.parse(__commits[__commits.length - 1]);
const plusButton = findAll(initial.root, "Button")[1];
const pressHandled = globalThis.__dispatchEvent(plusButton.id, "press");
const afterPress = JSON.parse(__commits[__commits.length - 1]);

const toggle = findAll(afterPress.root, "Toggle")[0];
const changeHandled = globalThis.__dispatchEvent(
  toggle.id, "change", JSON.stringify({ value: true }));
const afterChange = JSON.parse(__commits[__commits.length - 1]);

print(JSON.stringify({
  logs: __logs,
  commitCount: __commits.length,
  initialCount: findAll(initial.root, "Text")[1].props.text,
  pressHandled,
  countAfterPress: findAll(afterPress.root, "Text")[1].props.text,
  changeHandled,
  toggleAfterChange: findAll(afterChange.root, "Toggle")[0].props.value,
  heartAfterChange: findAll(afterChange.root, "Image")[0].props.systemName,
}));
`;

describe("quickjs smoke", () => {
  let result: {
    logs: string[];
    commitCount: number;
    initialCount: string;
    pressHandled: boolean;
    countAfterPress: string;
    changeHandled: boolean;
    toggleAfterChange: boolean;
    heartAfterChange: string;
  };

  beforeAll(() => {
    execFileSync("node", [join(jsRoot, "scripts/build.mjs")], {
      stdio: "pipe",
    });
    const bundle = readFileSync(bundlePath, "utf8");
    const dir = mkdtempSync(join(tmpdir(), "qjs-smoke-"));
    const scriptPath = join(dir, "smoke.js");
    writeFileSync(scriptPath, harnessPrelude + bundle + harnessEpilogue);
    const stdout = execFileSync("qjs", [scriptPath], { encoding: "utf8" });
    result = JSON.parse(stdout.trim());
  });

  it("renders the initial tree inside QuickJS", () => {
    expect(result.initialCount).toBe("Count: 0");
    expect(result.commitCount).toBeGreaterThanOrEqual(1);
  });

  it("handles a press event end-to-end", () => {
    expect(result.pressHandled).toBe(true);
    expect(result.countAfterPress).toBe("Count: 1");
  });

  it("handles a change event with JSON payload end-to-end", () => {
    expect(result.changeHandled).toBe(true);
    expect(result.toggleAfterChange).toBe(true);
    expect(result.heartAfterChange).toBe("heart.fill");
  });
});
