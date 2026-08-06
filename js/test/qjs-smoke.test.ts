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

// This suite shells out to a real `qjs` binary (see beforeAll). Fresh-clone
// contributors won't have QuickJS installed, and an unguarded execFileSync
// would hard-crash the whole file with an opaque ENOENT. So we probe for qjs
// ONCE here and skip the suite self-describingly when it's absent — the skip
// shows up in the vitest summary instead of silently dropping coverage.
// Escape hatch: CI that installs QuickJS sets REQUIRE_QJS=1, which turns a
// missing qjs into a loud failure so the engine-compatibility gate can never
// be skipped by accident there.
const requireQjs = process.env.REQUIRE_QJS === "1";
const qjsAvailable = (() => {
  try {
    execFileSync("qjs", ["-e", ""], { stdio: "ignore" });
    return true;
  } catch (error) {
    // Only ENOENT means "not installed"; any other failure (broken install,
    // bad exit) is NOT a reason to skip — run the suite and fail loud there.
    return (error as NodeJS.ErrnoException).code !== "ENOENT";
  }
})();

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
const initialPublished = latestPublished();

// ARCH-09 lazy mounting: at launch only the root screen serializes — the
// /counter, /hydration, and /stopwatch subtrees don't exist in the tree yet.
const lazyAtLaunch = textStartingWith(initial, "Count: ") === undefined
  && findAll(initial, "Toggle").length === 0;

// Navigation is a confirmed transaction: the demo's controlled stack folds
// the proposal synchronously, so the dispatch returns accepted:true and the
// SAME commit already carries the newly mounted destination subtree.
const navResult = JSON.parse(globalThis.__dispatchEvent(
  initial.id, "pathChange", JSON.stringify({ path: ["/counter"] }), 11));
const ackedSeq = JSON.parse(__commits[__commits.length - 1]).seq;
const initialCount = textStartingWith(latestTree(), "Count: ").props.text;

// __dispatchEvent returns the structured verdict as a JSON string (ARCH-09).
const pressResult = JSON.parse(globalThis.__dispatchEvent(
  buttonWithLabel(latestTree(), "+").id, "press", undefined, 12));
const countAfterPress = textStartingWith(latestTree(), "Count: ").props.text;

const toggle = findAll(latestTree(), "Toggle")[0];
const changeResult = JSON.parse(globalThis.__dispatchEvent(
  toggle.id, "change", JSON.stringify({ value: true })));
const toggleAfterChange = findAll(latestTree(), "Toggle")[0].props.value;

// Multi-entry stack: the covered /counter entry stays serialized under
// /hydration (every active-stack entry keeps its subtree, only the top is
// focused).
const nav2Accepted = JSON.parse(globalThis.__dispatchEvent(
  initial.id, "pathChange",
  JSON.stringify({ path: ["/counter", "/hydration"] }), 13)).accepted;
const counterStillMounted =
  textStartingWith(latestTree(), "Count: ") !== undefined;

const publishedBefore = __published.length;
globalThis.__dispatchEvent(buttonWithLabel(latestTree(), "Add glass").id, "press");
const hydrationPublished = latestPublished();

// Replacing the stack pops /counter + /hydration: their subtrees leave the
// committed tree, and /stopwatch mounts.
const nav3Accepted = JSON.parse(globalThis.__dispatchEvent(
  initial.id, "pathChange", JSON.stringify({ path: ["/stopwatch"] }), 14)).accepted;
const counterUnmountedAfterPop =
  textStartingWith(latestTree(), "Count: ") === undefined;

// Native push entrypoint: the Stopwatch screen registers its "scenePhase"
// listener on mount — under lazy mounting that's first open (the navigation
// above), not launch — so a native push routes through runSync and commits a
// new tree synchronously.
const pushExists = typeof globalThis.__pushNativeEvent === "function";
const pushHandled = globalThis.__pushNativeEvent("scenePhase",
  JSON.stringify({ phase: "background" }));
const phaseText = findAll(latestTree(), "Text")
  .map((t) => String(t.props.text))
  .find((t) => t.indexOf("phase:") >= 0);

print(JSON.stringify({
  logs: __logs,
  rootType: initial.type,
  lazyAtLaunch,
  navResult,
  nav2Accepted,
  counterStillMounted,
  nav3Accepted,
  counterUnmountedAfterPop,
  initialCount,
  pressResult,
  ackedSeq,
  countAfterPress,
  pushExists,
  pushHandled,
  phaseText,
  changeResult,
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
// The ControlWidgetToggle path: the OS's SetValueIntent dispatches a
// direction-specific handler, whose Storage write republishes the payload —
// so the toggle's published \`value\` must follow, in the real engine.
const togglePublishesFalse =
  JSON.parse(__published[__published.length - 1])
    .controls["hydration.reminders"].value === false;
const remindersOn = globalThis.__handleIntent("remindersOn");
const last = JSON.parse(__published[__published.length - 1]);
const rendered = JSON.parse(globalThis.__renderWidgets(1750000000000));
print(JSON.stringify({
  handled1, handled2, unknown,
  publishCount: __published.length,
  storedGlasses: __counterGet("hydration.glasses"),
  gauge: last.widgets.hydration.accessoryCircular.entries[0].tree.props.value,
  control: last.controls["hydration.addGlass"],
  togglePublishesFalse, remindersOn,
  toggleControl: last.controls["hydration.reminders"],
  daypartEntryCount: last.widgets.daypart.accessoryRectangular.entries.length,
  daypartRelevance:
    last.widgets.daypart.accessoryRectangular.entries[0].relevance.score > 0,
  renderedGauge:
    rendered.widgets.hydration.accessoryCircular.entries[0].tree.props.value,
}));
`;

describe.skipIf(!qjsAvailable && !requireQjs)("quickjs smoke", () => {
  let result: {
    logs: string[];
    rootType: string;
    lazyAtLaunch: boolean;
    navResult: { handled: boolean; accepted: boolean };
    nav2Accepted: boolean;
    counterStillMounted: boolean;
    nav3Accepted: boolean;
    counterUnmountedAfterPop: boolean;
    initialCount: string;
    pressResult: { handled: boolean; accepted: boolean };
    ackedSeq: number;
    countAfterPress: string;
    pushExists: boolean;
    pushHandled: boolean;
    phaseText: string;
    changeResult: { handled: boolean; accepted: boolean };
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
    control: {
      intent: string;
      label: string;
      systemName: string;
      actionLabel: string;
    };
    togglePublishesFalse: boolean;
    remindersOn: boolean;
    toggleControl: {
      intent: string;
      label: string;
      systemName: string;
      value: boolean;
    };
    daypartEntryCount: number;
    daypartRelevance: boolean;
    renderedGauge: number;
  };

  beforeAll(() => {
    // Reached with qjs missing only under REQUIRE_QJS=1 (otherwise the suite
    // is skipped above) — fail with a message that names the fix.
    if (!qjsAvailable) {
      throw new Error(
        "REQUIRE_QJS=1 is set but no `qjs` binary is on PATH. " +
          "Install QuickJS (e.g. `brew install quickjs`) — this suite is the " +
          "engine-compatibility gate and must not be skipped in CI.",
      );
    }
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
  });

  it("mounts routes lazily and confirms navigation inside the dispatch (ARCH-09)", () => {
    // Launch tree carries only the root screen…
    expect(result.lazyAtLaunch).toBe(true);
    // …and a proposed path folds + mounts within the confirming dispatch.
    expect(result.navResult).toEqual({ handled: true, accepted: true });
    expect(result.initialCount).toBe("Count: 0");
    expect(result.ackedSeq).toBe(11);
  });

  it("keeps covered stack entries serialized and unmounts popped ones", () => {
    expect(result.nav2Accepted).toBe(true);
    expect(result.counterStillMounted).toBe(true);
    expect(result.nav3Accepted).toBe(true);
    expect(result.counterUnmountedAfterPop).toBe(true);
  });

  it("handles a press event end-to-end", () => {
    expect(result.pressResult).toEqual({ handled: true, accepted: true });
    expect(result.countAfterPress).toBe("Count: 1");
  });

  it("routes a native push through runSync and commits synchronously", () => {
    expect(result.pushExists).toBe(true);
    expect(result.pushHandled).toBe(true);
    // The pushed phase landed in the committed tree without any awaiting.
    expect(result.phaseText).toContain("background");
  });

  it("handles a change event with JSON payload end-to-end", () => {
    expect(result.changeResult).toEqual({ handled: true, accepted: true });
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
    // Three dispatches that WROTE (addGlass x2 + remindersOn) -> three
    // republishes; the unknown intent wrote nothing and published nothing.
    expect(intentResult.publishCount).toBe(3);
    expect(intentResult.storedGlasses).toBe(2);
    expect(intentResult.gauge).toBe(2);
  });

  it("publishes control metadata and multi-entry relevance timelines", () => {
    expect(intentResult.control).toEqual({
      intent: "addGlass",
      label: "Add Glass",
      systemName: "drop.fill",
      actionLabel: "Adding\u2026",
    });
    expect(intentResult.daypartEntryCount).toBeGreaterThanOrEqual(4);
    expect(intentResult.daypartRelevance).toBe(true);
  });

  // `value` is what makes a control a toggle rather than a button, so the
  // round trip that matters is: published state -> the OS draws it -> the
  // user's SetValueIntent -> a React handler -> a republish carrying the NEW
  // state. Driven here through the real engine, not a mocked host.
  it("publishes ControlWidgetToggle state and updates it through the intent", () => {
    expect(intentResult.togglePublishesFalse).toBe(true);
    expect(intentResult.remindersOn).toBe(true);
    expect(intentResult.toggleControl).toEqual({
      intent: "reminders",
      label: "Hydration Reminders",
      systemName: "bell.badge.fill",
      value: true,
    });
  });

  it("renders fresh timelines on demand via __renderWidgets", () => {
    expect(intentResult.renderedGauge).toBe(2);
  });
});
