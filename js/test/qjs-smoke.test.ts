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
const __published = [];
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
  publishWidgets: (json) => { __published.push(json); },
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
function buttonWithLabel(root, label) {
  return findAll(root, "Button").find((b) =>
    findAll(b, "Text").some((t) => t.props.text === label));
}
function textStartingWith(root, prefix) {
  return findAll(root, "Text").find((t) =>
    String(t.props.text).startsWith(prefix));
}
const latestTree = () => JSON.parse(__commits[__commits.length - 1]).root;
const latestPublished = () => JSON.parse(__published[__published.length - 1]);

const initial = latestTree();
const initialCount = textStartingWith(initial, "Count: ").props.text;
const initialPublished = latestPublished();

const pressHandled = globalThis.__dispatchEvent(
  buttonWithLabel(initial, "+").id, "press");
const countAfterPress = textStartingWith(latestTree(), "Count: ").props.text;

const toggle = findAll(latestTree(), "Toggle")[0];
const changeHandled = globalThis.__dispatchEvent(
  toggle.id, "change", JSON.stringify({ value: true }));
const toggleAfterChange = findAll(latestTree(), "Toggle")[0].props.value;

const publishedBefore = __published.length;
globalThis.__dispatchEvent(buttonWithLabel(latestTree(), "Add glass").id, "press");
const hydrationPublished = latestPublished();

print(JSON.stringify({
  logs: __logs,
  rootType: initial.type,
  initialCount,
  pressHandled,
  countAfterPress,
  changeHandled,
  toggleAfterChange,
  initialGauge: initialPublished
    .widgets.hydration.accessoryCircular.entries[0].tree.props.value,
  initialInline: initialPublished
    .widgets.hydration.accessoryInline.entries[0].tree.props.text,
  publishedOnAdd: __published.length > publishedBefore,
  gaugeAfterAdd: hydrationPublished
    .widgets.hydration.accessoryCircular.entries[0].tree.props.value,
  inlineAfterAdd: hydrationPublished
    .widgets.hydration.accessoryInline.entries[0].tree.props.text,
  publishedFamilies:
    Object.keys(hydrationPublished.widgets.hydration).sort(),
}));
`;

describe("quickjs smoke", () => {
  let result: {
    logs: string[];
    rootType: string;
    initialCount: string;
    pressHandled: boolean;
    countAfterPress: string;
    changeHandled: boolean;
    toggleAfterChange: boolean;
    initialGauge: number;
    initialInline: string;
    publishedOnAdd: boolean;
    gaugeAfterAdd: number;
    inlineAfterAdd: string;
    publishedFamilies: string[];
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

  it("renders the initial navigation tree inside QuickJS", () => {
    expect(result.rootType).toBe("NavigationStack");
    expect(result.initialCount).toBe("Count: 0");
  });

  it("handles a press event end-to-end", () => {
    expect(result.pressHandled).toBe(true);
    expect(result.countAfterPress).toBe("Count: 1");
  });

  it("handles a change event with JSON payload end-to-end", () => {
    expect(result.changeHandled).toBe(true);
    expect(result.toggleAfterChange).toBe(true);
  });

  it("publishes widget timelines for all accessory families at startup", () => {
    expect(result.publishedFamilies).toEqual([
      "accessoryCircular",
      "accessoryCorner",
      "accessoryInline",
      "accessoryRectangular",
    ]);
    expect(result.initialGauge).toBe(0);
    expect(result.initialInline).toBe("Water 0/8");
  });

  it("republishes updated complication timelines after an interaction", () => {
    expect(result.publishedOnAdd).toBe(true);
    expect(result.gaugeAfterAdd).toBe(1);
    expect(result.inlineAfterAdd).toBe("Water 1/8");
  });
});
