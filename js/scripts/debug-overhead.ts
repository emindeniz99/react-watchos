/**
 * Measure what the source-level debugger's instrumentation costs
 * (docs/design-dap-debugger.md, "The measured cost").
 *
 * Builds the demo app bundle three ways — no probes, probes in app code, probes
 * in app code AND the renderer — and runs each through the reference C host
 * (tools/embed-smoke/embed-host.c: the exact embedding sequence JSRuntime.swift
 * uses, linked against the VENDORED quickjs-ng). Reports bytes, boot ms and
 * QuickJS heap, medians over several runs.
 *
 * The measured configuration is DETACHED — no `__debugPoll` is installed — on
 * purpose: that is what a developer running an instrumented bundle without the
 * dev server attached pays, and it is the number that decides whether `dev
 * --debug` can be left on. The attached cost is not a number, it is a design
 * choice: a paused watch is blocked by definition.
 *
 *   node --experimental-strip-types scripts/debug-overhead.ts [--runs 9]
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { build } from "esbuild";
import { watchBuildOptions } from "../esbuild/preset.mts";
import { targets } from "./config.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../..");
const smokeDir = join(repoRoot, "tools/embed-smoke");
const benchEpilogue = join(smokeDir, "bench-epilogue.js");
const vendorInclude = join(repoRoot, "js/swift/Sources/CQuickJS/include");

const { values } = parseArgs({
  options: { runs: { type: "string", default: "9" } },
});
const runs = Number(values.runs);

const appTarget = targets.find((t) => t.name === "app");
if (!appTarget) throw new Error("debug-overhead: no `app` target in config.ts");

const work = mkdtempSync(join(tmpdir(), "rnw-dbg-overhead-"));

/** Link the reference host against the shared engine objects (built once). */
function buildEmbedHost(): string {
  const objDir = execFileSync(
    join(repoRoot, "tools/vendored-qjs/build.sh"),
    ["--objdir"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  ).trim();
  const binary = join(work, "embed-host");
  execFileSync(
    process.env.CC ?? "cc",
    [
      "-O2",
      "-std=gnu11",
      "-DNDEBUG",
      `-I${vendorInclude}`,
      "-o",
      binary,
      join(smokeDir, "embed-host.c"),
      ...expandObjects(objDir),
      "-lm",
      "-lpthread",
    ],
    { stdio: "inherit" },
  );
  return binary;
}

function expandObjects(objDir: string): string[] {
  return ["quickjs", "libregexp", "libunicode", "dtoa"].map((unit) =>
    join(objDir, `${unit}.o`),
  );
}

interface Measurement {
  label: string;
  bytes: number;
  /** Parse: scales with bundle SIZE, so it moves with the probes' bytes. */
  parseMs: number;
  /** Eval: scales with what actually RUNS, so it is the probes' own cost. */
  evalMs: number;
  bootMs: number;
  heapMB: number;
  /** One full tap through the pipeline (React render + serialize + commit),
   *  from tools/embed-smoke/bench-epilogue.js — the steady-state cost that
   *  boot time cannot see. */
  perDispatchMs: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

function measure(binary: string, bundle: string, label: string): Measurement {
  const boots: number[] = [];
  const parses: number[] = [];
  const evals: number[] = [];
  const heaps: number[] = [];
  const dispatches: number[] = [];
  for (let i = 0; i < runs; i++) {
    // The host prints its result on stdout and its [boot]/[mem] diagnostics on
    // STDERR, so this needs spawnSync — execFileSync hands back stdout only.
    const run = spawnSync(binary, [bundle], { encoding: "utf8" });
    if (run.status !== 0) {
      throw new Error(
        `embed-host failed on ${bundle}:\n${run.stderr ?? run.error}`,
      );
    }
    const stderr = run.stderr ?? "";
    const boot =
      /\[boot\] \w+ ([\d.]+) ms \+ eval ([\d.]+) ms = ([\d.]+) ms total/.exec(
        stderr,
      );
    const heap = /quickjs heap: ([\d.]+) MB/.exec(stderr);
    if (boot) {
      parses.push(Number(boot[1]));
      evals.push(Number(boot[2]));
      boots.push(Number(boot[3]));
    }
    if (heap?.[1]) heaps.push(Number(heap[1]));

    // The steady-state number: the same tap benchmark tools/embed-smoke/bench.sh
    // runs, against this bundle.
    const bench = spawnSync(binary, [bundle, benchEpilogue], {
      encoding: "utf8",
    });
    if (bench.status === 0) {
      const parsed = JSON.parse(bench.stdout.trim()) as {
        perDispatchMs: number;
      };
      dispatches.push(parsed.perDispatchMs);
    }
  }
  return {
    label,
    bytes: statSync(bundle).size,
    parseMs: median(parses),
    evalMs: median(evals),
    bootMs: median(boots),
    heapMB: median(heaps),
    perDispatchMs: median(dispatches),
  };
}

const shapes: Array<{
  label: string;
  debug: boolean;
  includeRenderer: boolean;
}> = [
  { label: "baseline (dev, no probes)", debug: false, includeRenderer: false },
  { label: "debug (app code)", debug: true, includeRenderer: false },
  { label: "debug (app + renderer)", debug: true, includeRenderer: true },
];

const binary = buildEmbedHost();
const results: Measurement[] = [];
for (const shape of shapes) {
  const outfile = join(
    work,
    `${shape.debug ? "dbg" : "base"}-${results.length}.js`,
  );
  const options = watchBuildOptions({
    entry: appTarget.entry,
    outfile,
    minify: false,
    sourcemap: false,
    network: appTarget.requiredFeatures.includes("network"),
    debug: shape.debug,
    debugIncludeRenderer: shape.includeRenderer,
  });
  // The demo entry reads these two through the bundler (QuickJS has no
  // `process`), and scripts/config.ts normally supplies them. Set here rather
  // than reusing `buildOptions` so all three shapes are built identically
  // apart from the probes — in particular with the React Compiler OFF in every
  // one, since a debug build never runs it and a baseline that did would put
  // its memoization into the delta.
  options.define = {
    ...options.define,
    "process.env.REACT_WATCH_OTA_URL": '""',
    "process.env.BUNDLE_VERSION": '"1"',
  };
  await build(options);
  results.push(measure(binary, outfile, shape.label));
}

const base = results[0];
if (!base) throw new Error("debug-overhead: no baseline measurement");
console.log(
  `\ndemo app bundle, median of ${runs} runs in the vendored quickjs-ng\n`,
);
const columns = [
  "bytes",
  "vs base",
  "parse ms",
  "eval ms",
  "boot ms",
  "vs base",
  "heap MB",
  "tap ms",
  "vs base",
];
console.log("shape".padEnd(26) + columns.map((h) => h.padStart(10)).join(""));
const pct = (value: number, reference: number) =>
  `${value >= reference ? "+" : ""}${((value / reference - 1) * 100).toFixed(1)}%`;
for (const r of results) {
  console.log(
    r.label.padEnd(26) +
      String(r.bytes).padStart(10) +
      (r === base ? "—" : pct(r.bytes, base.bytes)).padStart(10) +
      r.parseMs.toFixed(1).padStart(10) +
      r.evalMs.toFixed(1).padStart(10) +
      r.bootMs.toFixed(1).padStart(10) +
      (r === base ? "—" : pct(r.bootMs, base.bootMs)).padStart(10) +
      r.heapMB.toFixed(1).padStart(10) +
      r.perDispatchMs.toFixed(3).padStart(10) +
      (r === base ? "—" : pct(r.perDispatchMs, base.perDispatchMs)).padStart(
        10,
      ),
  );
}
console.log();
