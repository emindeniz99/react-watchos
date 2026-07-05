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
// ARCH-03: the widget extension evaluates its OWN, smaller bundle — never the
// app bundle — so the intent path runs widget.bundle.js here.
const widgetBundlePath = join(jsRoot, "dist/widget.bundle.js");

// Atomic-counter mock (ARCH-05), shared by both prelude harnesses: mirrors
// CoordinatedCounterStore's clamped read-modify-write that JSRuntime.swift
// installs as counterGet/counterAdd. Declared after "use strict" in each.
const counterHostMock = `
const __counters = new Map();
const __counterGet = (key) => __counters.get(key) ?? 0;
const __counterAdd = (key, delta, min, max) => {
  const next = Math.max(min, Math.min(max, (__counters.get(key) ?? 0) + delta));
  __counters.set(key, next);
  return next;
};
`;

const harnessPrelude = `
"use strict";
${counterHostMock}
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
  counterGet: __counterGet,
  counterAdd: __counterAdd,
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
  buttonWithLabel(initial, "+").id, "press", undefined, 11);
const ackedSeq = JSON.parse(__commits[__commits.length - 1]).seq;
const countAfterPress = textStartingWith(latestTree(), "Count: ").props.text;

const toggle = findAll(latestTree(), "Toggle")[0];
const changeHandled = globalThis.__dispatchEvent(
  toggle.id, "change", JSON.stringify({ value: true }));
const toggleAfterChange = findAll(latestTree(), "Toggle")[0].props.value;

const publishedBefore = __published.length;
globalThis.__dispatchEvent(buttonWithLabel(latestTree(), "Add glass").id, "press");
const hydrationPublished = latestPublished();

// Native push entrypoint: the Stopwatch screen (eagerly mounted as a
// NavigationRoute destination) registers a "scenePhase" listener, so a
// native push routes through runSync and commits a new tree synchronously.
const pushExists = typeof globalThis.__pushNativeEvent === "function";
const pushHandled = globalThis.__pushNativeEvent("scenePhase",
  JSON.stringify({ phase: "background" }));
const phaseText = findAll(latestTree(), "Text")
  .map((t) => String(t.props.text))
  .find((t) => t.indexOf("phase:") >= 0);

print(JSON.stringify({
  logs: __logs,
  rootType: initial.type,
  initialCount,
  pressHandled,
  ackedSeq,
  countAfterPress,
  pushExists,
  pushHandled,
  phaseText,
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

// Mirrors IntentRuntime.swift in the widget extension: the WIDGET bundle (which
// has no App import / runApp), storage bridge, no UI mount. `commit` throws, so
// the test fails loud if the widget bundle ever tries to mount UI.
const intentPrelude = `
"use strict";
${counterHostMock}
const __published = [];
const __storage = new Map();
const __armedTimers = [];
globalThis.__host = {
  commit: () => { throw new Error("intent entrypoint must not mount UI"); },
  log: () => {},
  setTimer: (id, ms) => { __armedTimers.push(id); },
  clearTimer: () => {},
  publishWidgets: (json) => { __published.push(json); },
  getItem: (key) => __storage.get(key) ?? null,
  setItem: (key, value) => { __storage.set(key, value); },
  counterGet: __counterGet,
  counterAdd: __counterAdd,
};
`;

const intentEpilogue = `
const handled1 = globalThis.__handleIntent("addGlass");
const handled2 = globalThis.__handleIntent("addGlass");
const unknown = globalThis.__handleIntent("doesNotExist");
const last = JSON.parse(__published[__published.length - 1]);
const rendered = JSON.parse(globalThis.__renderWidgets(1750000000000));
print(JSON.stringify({
  handled1, handled2, unknown,
  publishCount: __published.length,
  storedGlasses: __counterGet("hydration.glasses"),
  gauge: last.widgets.hydration.accessoryCircular.entries[0].tree.props.value,
  control: last.controls["hydration.addGlass"],
  daypartEntryCount: last.widgets.daypart.accessoryRectangular.entries.length,
  daypartRelevance:
    last.widgets.daypart.accessoryRectangular.entries[0].relevance.score > 0,
  renderedGauge:
    rendered.widgets.hydration.accessoryCircular.entries[0].tree.props.value,
}));
`;

describe("quickjs smoke", () => {
  let result: {
    logs: string[];
    rootType: string;
    initialCount: string;
    pressHandled: boolean;
    ackedSeq: number;
    countAfterPress: string;
    pushExists: boolean;
    pushHandled: boolean;
    phaseText: string;
    changeHandled: boolean;
    toggleAfterChange: boolean;
    initialGauge: number;
    initialInline: string;
    publishedOnAdd: boolean;
    gaugeAfterAdd: number;
    inlineAfterAdd: string;
    publishedFamilies: string[];
  };
  let intentResult: {
    handled1: boolean;
    handled2: boolean;
    unknown: boolean;
    publishCount: number;
    storedGlasses: number;
    gauge: number;
    control: { intent: string; label: string; systemName: string };
    daypartEntryCount: number;
    daypartRelevance: boolean;
    renderedGauge: number;
  };

  beforeAll(() => {
    // --experimental-strip-types runs the .ts build on any Node >= 22.6 (a
    // no-op on 24+); process.execPath = the Node running vitest.
    execFileSync(
      process.execPath,
      ["--experimental-strip-types", join(jsRoot, "scripts/build.ts")],
      { stdio: "pipe" },
    );
    const bundle = readFileSync(bundlePath, "utf8");
    const dir = mkdtempSync(join(tmpdir(), "qjs-smoke-"));

    const appScript = join(dir, "smoke-app.js");
    writeFileSync(appScript, harnessPrelude + bundle + harnessEpilogue);
    result = JSON.parse(
      execFileSync("qjs", [appScript], { encoding: "utf8" }).trim(),
    );

    const widgetBundle = readFileSync(widgetBundlePath, "utf8");
    const intentScript = join(dir, "smoke-intent.js");
    writeFileSync(intentScript, intentPrelude + widgetBundle + intentEpilogue);
    intentResult = JSON.parse(
      execFileSync("qjs", [intentScript], { encoding: "utf8" }).trim(),
    );
  });

  it("renders the initial navigation tree inside QuickJS", () => {
    expect(result.rootType).toBe("NavigationStack");
    expect(result.initialCount).toBe("Count: 0");
  });

  it("handles a press event end-to-end and acks its seq", () => {
    expect(result.pressHandled).toBe(true);
    expect(result.countAfterPress).toBe("Count: 1");
    expect(result.ackedSeq).toBe(11);
  });

  it("routes a native push through runSync and commits synchronously", () => {
    expect(result.pushExists).toBe(true);
    expect(result.pushHandled).toBe(true);
    // The pushed phase landed in the committed tree without any awaiting.
    expect(result.phaseText).toContain("background");
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

  it("handles control intents without mounting UI (widget extension path)", () => {
    expect(intentResult.handled1).toBe(true);
    expect(intentResult.handled2).toBe(true);
    expect(intentResult.unknown).toBe(false);
    expect(intentResult.publishCount).toBe(2);
    expect(intentResult.storedGlasses).toBe(2);
    expect(intentResult.gauge).toBe(2);
  });

  it("publishes control metadata and multi-entry relevance timelines", () => {
    expect(intentResult.control).toEqual({
      intent: "addGlass",
      label: "Add Glass",
      systemName: "drop.fill",
    });
    expect(intentResult.daypartEntryCount).toBeGreaterThanOrEqual(4);
    expect(intentResult.daypartRelevance).toBe(true);
  });

  it("renders fresh timelines on demand via __renderWidgets", () => {
    expect(intentResult.renderedGauge).toBe(2);
  });
});
