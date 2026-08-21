import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { beforeAll, describe, expect, it } from "vitest";
import type { DapMessage } from "../bin/dap-session.mts";
import {
  DapDecoder,
  encodeDapMessage,
  startDebugServer,
} from "../bin/debug-server.mts";
import type { DebugManifest } from "../esbuild/debug-probe.mts";
import { buildBundles, watchBuildOptions } from "../esbuild/preset.mts";

/**
 * The source-level debugger spike (docs/design-dap-debugger.md).
 *
 * The centrepiece is the "pauses, steps and continues" case below, and it is
 * deliberately end-to-end in the REAL engine: the fixture is instrumented by
 * the real build transform, the commands come from the real `DapSession`
 * (bundled into the harness, not mocked), and the whole thing executes in the
 * vendored quickjs-ng — the same sources SwiftPM compiles for watchOS. A
 * debugger that only worked in Node would prove nothing about the watch,
 * because the whole design rests on a blocking synchronous exchange that Node
 * would happily fake and QuickJS would not.
 */

// Same engine gate as qjs-smoke.test.ts: build the VENDORED quickjs-ng (not
// whatever `qjs` is on PATH — that is Bellard's, a different engine). A fresh
// clone without a C compiler skips; REQUIRE_QJS=1 turns the skip into a
// failure so CI can never silently drop the gate.
const requireQjs = process.env.REQUIRE_QJS === "1";
const qjsBin = (() => {
  const preBuilt = process.env.QJS_BIN;
  if (preBuilt) return preBuilt;
  try {
    return execFileSync(join(__dirname, "../../tools/vendored-qjs/build.sh"), {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    }).trim();
  } catch {
    return "";
  }
})();
const qjsAvailable = qjsBin !== "";

const fixture = join(__dirname, "fixtures/debug-stepping.entry.ts");
/** Line 12 is `export function add(...)` — a DECLARATION, which carries no
 *  probe. Setting the breakpoint there on purpose: DAP expects the adapter to
 *  report the line it actually used, and 13 (`const sum = a + b;`) is it. */
const REQUESTED_BREAKPOINT_LINE = 12;
const EFFECTIVE_BREAKPOINT_LINE = 13;

let workDir = "";

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "rnw-dap-"));
});

describe("debug instrumentation", () => {
  it("probes statements, not declarations, and records them in a manifest", async () => {
    const outfile = join(workDir, "manifest-probe/bundle.js");
    let manifest: DebugManifest | undefined;
    await build(
      watchBuildOptions({
        entry: fixture,
        outfile,
        debug: true,
        sourcemap: false,
        network: false,
        plugins: [
          {
            name: "capture-manifest",
            setup(b) {
              b.onEnd(() => {
                manifest = JSON.parse(
                  readFileSync(`${outfile}.dbg.json`, "utf8"),
                ) as DebugManifest;
              });
            },
          },
        ],
      }),
    );
    const file = manifest?.files.find((f) => f.path === fixture);
    // Every executable statement, and NOTHING else: line 12 is the function
    // declaration, 15/21/23 are closing braces, 16/24 are blank.
    expect(file?.lines).toEqual([13, 14, 18, 19, 20, 22, 25, 26]);
    // The renderer's own src/ is not instrumented by default — the injected
    // shims are in the bundle, but none of their statements carry a probe.
    expect(manifest?.files.map((f) => f.path)).toEqual([fixture]);
  });

  it("keeps every probe out of a shipping bundle", async () => {
    const shipped = join(workDir, "shipped/bundle.js");
    await buildBundles([{ name: "app", entry: fixture, outfile: shipped }]);
    const code = readFileSync(shipped, "utf8");
    // Not "no __dbg( calls" — no `__dbg` ANYWHERE. The probe runtime is
    // injected, so a leak would show up as the runtime's globals even if every
    // call site had been folded away.
    expect(code).not.toContain("__dbg");
    expect(code).toContain("__result"); // …and the bundle really is this entry.

    // The ordinary dev build (unminified, dev define on) is also clean: the
    // instrumentation is a separate opt-in, not a side effect of dev-ness.
    const dev = join(workDir, "dev/bundle.js");
    await build(
      watchBuildOptions({ entry: fixture, outfile: dev, sourcemap: false }),
    );
    expect(readFileSync(dev, "utf8")).not.toContain("__dbg");
  });
});

describe("DAP base protocol framing", () => {
  it("round-trips messages split across arbitrary chunk boundaries", () => {
    const messages: DapMessage[] = [
      { seq: 1, type: "request", command: "initialize" },
      // A multi-byte body: Content-Length counts BYTES, so a decoder that
      // buffered strings would slice this frame in the wrong place.
      {
        seq: 2,
        type: "event",
        event: "output",
        body: { output: "héllo ⌚️ wörld" },
      },
    ];
    const wire = Buffer.concat(messages.map(encodeDapMessage));
    const decoder = new DapDecoder();
    const seen: DapMessage[] = [];
    for (let i = 0; i < wire.length; i += 7) {
      decoder.push(wire.subarray(i, i + 7), (m) => seen.push(m));
    }
    expect(seen).toEqual(messages);
  });
});

describe.skipIf(!qjsAvailable && !requireQjs)("dap debugger in quickjs", () => {
  interface Frame {
    name: string;
    line: number;
    source: string | null;
  }
  interface Stop {
    reason: string;
    frames: Frame[];
    variables: Array<{ name: string; value: string }>;
  }
  let run: {
    stops: Stop[];
    evaluations: string[];
    verified: Array<{ verified: boolean; line?: number; message?: string }>;
    result: number;
    stoppedEvents: number;
    continuedEvents: number;
  };

  beforeAll(async () => {
    if (!qjsAvailable) {
      throw new Error(
        "REQUIRE_QJS=1 is set but the vendored quickjs-ng could not be " +
          "built. tools/vendored-qjs/build.sh needs a C compiler (cc). This " +
          "suite is the debugger's engine gate and must not be skipped in CI.",
      );
    }

    // (1) The instrumented fixture, through the real preset.
    const bundlePath = join(workDir, "qjs/bundle.js");
    await build(
      watchBuildOptions({
        entry: fixture,
        outfile: bundlePath,
        debug: true,
        sourcemap: false,
        network: false,
      }),
    );
    const manifest = readFileSync(`${bundlePath}.dbg.json`, "utf8");

    // (2) The REAL DAP adapter, bundled for the engine. This is what makes the
    // run below an integration test rather than a mock: the commands the probe
    // obeys are produced by bin/dap-session.mts, the same module the dev
    // server serves over TCP.
    const adapterEntry = join(workDir, "adapter-entry.ts");
    writeFileSync(
      adapterEntry,
      `import { DapSession } from ${JSON.stringify(
        join(__dirname, "../bin/dap-session.mts"),
      )};\n` +
        "(globalThis as { __DapSession?: unknown }).__DapSession = DapSession;\n",
    );
    const adapterPath = join(workDir, "qjs/adapter.js");
    await build({
      entryPoints: [adapterEntry],
      outfile: adapterPath,
      bundle: true,
      format: "iife",
      platform: "neutral",
      target: "es2020",
      logLevel: "silent",
    });

    // (3) The editor. A scripted DAP client: it reacts to `stopped` by asking
    // for the stack and the arguments, then sends the next verb — exactly the
    // conversation VS Code has, minus the socket.
    const script = ["next", "stepOut", "stepIn", "continue", "continue"];
    const client = `
"use strict";
var __manifest = ${manifest};
var __script = ${JSON.stringify(script)};
var __stops = [], __evaluations = [], __verified = [], __transcript = [];
var __stack = [], __variables = [], __scopeRef = 0;
var __stopIndex = 0, __seq = 1;
var __session = new globalThis.__DapSession({
  manifest: function () { return __manifest; },
  send: function (m) {
    __transcript.push(m);
    if (m.type === "response" && m.command === "stackTrace") __stack = m.body.stackFrames;
    if (m.type === "response" && m.command === "scopes") __scopeRef = m.body.scopes[0].variablesReference;
    if (m.type === "response" && m.command === "variables") __variables = m.body.variables;
    if (m.type === "response" && m.command === "evaluate") __evaluations.push(m.body.result);
    if (m.type === "response" && m.command === "setBreakpoints") __verified = m.body.breakpoints;
    if (m.type === "event" && m.event === "stopped") __onStopped(m);
  },
});
function __send(command, args) {
  __session.handle({ seq: __seq++, type: "request", command: command, arguments: args || {} });
}
function __onStopped(m) {
  __send("stackTrace", { threadId: 1 });
  var frames = __stack.map(function (f) {
    return { name: f.name, line: f.line, source: f.source ? f.source.path : null };
  });
  __variables = [];
  __send("scopes", { frameId: 0 });
  if (__scopeRef !== 0) __send("variables", { variablesReference: __scopeRef });
  __stops.push({
    reason: m.body.reason,
    frames: frames,
    variables: __variables.map(function (v) { return { name: v.name, value: v.value }; }),
  });
  // One evaluate, at the first stop: it must be answered BEFORE the resume
  // verb, which is the only ordering that keeps the frame alive to answer it.
  if (__stopIndex === 0) __send("evaluate", { expression: "b", frameId: 0 });
  __send(__script[__stopIndex++] || "continue", { threadId: 1 });
}
__send("initialize", { adapterID: "react-watchos" });
__send("setBreakpoints", {
  source: { path: ${JSON.stringify(fixture)} },
  breakpoints: [{ line: ${REQUESTED_BREAKPOINT_LINE} }],
});
__send("configurationDone", {});
__send("attach", {});
globalThis.__debugPoll = function (json) {
  return JSON.stringify(__session.poll(JSON.parse(json)));
};
`;
    const epilogue = `
print(JSON.stringify({
  stops: __stops,
  evaluations: __evaluations,
  verified: __verified,
  result: globalThis.__result,
  stoppedEvents: __transcript.filter(function (m) {
    return m.type === "event" && m.event === "stopped";
  }).length,
  continuedEvents: __transcript.filter(function (m) {
    return m.type === "event" && m.event === "continued";
  }).length,
}));
`;
    const harness = join(workDir, "qjs/harness.js");
    writeFileSync(
      harness,
      readFileSync(adapterPath, "utf8") +
        client +
        readFileSync(bundlePath, "utf8") +
        epilogue,
    );
    run = JSON.parse(
      execFileSync(qjsBin, [harness], { encoding: "utf8" }).trim(),
    );
  }, 180_000);

  it("moves a breakpoint from a declaration to the next real statement", () => {
    expect(run.verified).toEqual([
      { verified: true, line: EFFECTIVE_BREAKPOINT_LINE },
    ]);
  });

  it("pauses, steps and continues in the order the client asked", () => {
    // breakpoint -> next -> stepOut -> stepIn -> continue (which re-arms the
    // breakpoint on the next loop iteration).
    expect(run.stops.map((s) => s.reason)).toEqual([
      "breakpoint",
      "step",
      "step",
      "step",
      "breakpoint",
    ]);
    // Every stop is announced exactly once, and every resume acknowledged.
    expect(run.stoppedEvents).toBe(5);
    expect(run.continuedEvents).toBe(5);
  });

  it("reports the stack in ORIGINAL source coordinates", () => {
    const lines = run.stops.map((s) =>
      s.frames.map((f) => `${f.name}:${f.line}`),
    );
    expect(lines).toEqual([
      // Stopped on the breakpoint inside add(), called from the loop body,
      // called from module scope. No source map was consulted to say this:
      // the probe was placed by something that could still see the .ts.
      ["add:13", "run:20", "(module):25"],
      // `next` — same frame, next statement.
      ["add:14", "run:20", "(module):25"],
      // `stepOut` — back in the caller. Statement granularity means this is
      // the loop body's next statement, not the middle of line 20.
      ["run:20", "(module):25"],
      // `stepIn` — into the call the stepped-over statement makes.
      ["add:13", "run:20", "(module):25"],
      // `continue` — the breakpoint again, third iteration.
      ["add:13", "run:20", "(module):25"],
    ]);
    // The frames carry the fixture's real path, so an editor can open them.
    expect(run.stops[0]?.frames[0]?.source).toBe(fixture);
  });

  it("reports the top frame's captured arguments as its scope", () => {
    // add(total, index) with total=0, index=0 on the first hit…
    expect(run.stops[0]?.variables).toEqual([
      { name: "a", value: "0" },
      { name: "b", value: "0" },
    ]);
    // …and index=2 by the last one, which is the loop having advanced twice.
    expect(run.stops[4]?.variables).toEqual([
      { name: "a", value: "1" },
      { name: "b", value: "2" },
    ]);
    // The stepped-out frame is `run`, whose captured parameter is `times`.
    expect(run.stops[2]?.variables).toEqual([{ name: "times", value: "3" }]);
  });

  it("answers evaluate from the paused frame before resuming", () => {
    expect(run.evaluations).toEqual(["0"]);
  });

  it("runs the program to completion once the client detaches", () => {
    // 0 + 0 + 1 + 2. If any resume had been dropped the harness would have
    // hung instead, so this is the "nothing was left parked" assertion.
    expect(run.result).toBe(3);
  });
});

describe("debug server transports", () => {
  it("carries a DAP session over TCP and answers the watch's poll", async () => {
    const manifestPath = join(workDir, "server-manifest.json");
    const manifest: DebugManifest = {
      v: 1,
      files: [{ path: fixture, lines: [13, 14, 18, 19, 20, 22, 25, 26] }],
    };
    writeFileSync(manifestPath, JSON.stringify(manifest));
    // Port 0: the OS picks free ports, so the suite cannot collide with a dev
    // server someone left running.
    const server = await startDebugServer({
      manifestPath,
      port: 0,
      dapPort: 0,
    });
    try {
      const { port, dapPort } = server.bound;
      const socket = createConnection({ port: dapPort, host: "127.0.0.1" });
      const received: DapMessage[] = [];
      const decoder = new DapDecoder();
      socket.on("data", (chunk: Buffer) => {
        decoder.push(chunk, (m) => received.push(m));
      });
      await new Promise((resolve) => socket.once("connect", resolve));

      const send = (command: string, args: Record<string, unknown>) =>
        socket.write(
          encodeDapMessage({
            seq: received.length + 1,
            type: "request",
            command,
            arguments: args,
          }),
        );
      send("initialize", {});
      send("setBreakpoints", {
        source: { path: fixture },
        breakpoints: [{ line: 12 }],
      });
      await waitFor(() =>
        received.some(
          (m) => m.type === "response" && m.command === "setBreakpoints",
        ),
      );

      // The watch's side of the channel: POST a running state, get the
      // breakpoint set back.
      const response = await fetch(`http://127.0.0.1:${port}/debug/poll`, {
        method: "POST",
        body: JSON.stringify({ v: 1, state: "running" }),
      });
      const command = (await response.json()) as {
        breakpoints?: Record<string, number[]>;
      };
      expect(command.breakpoints).toEqual({ "0": [13] });

      // …and a paused state raises `stopped` on the DAP socket.
      const paused = fetch(`http://127.0.0.1:${port}/debug/poll`, {
        method: "POST",
        body: JSON.stringify({
          v: 1,
          state: "paused",
          reason: "breakpoint",
          frames: [{ file: 0, line: 13, name: "add" }],
        }),
      });
      await waitFor(() =>
        received.some((m) => m.type === "event" && m.event === "stopped"),
      );
      send("continue", { threadId: 1 });
      expect(
        ((await (await paused).json()) as { action?: string }).action,
      ).toBe("continue");
      socket.destroy();
    } finally {
      await server.close();
    }
  }, 30_000);
});

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
