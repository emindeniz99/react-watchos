import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { buildBundles } from "../esbuild/preset.mts";

// The other end of the symbol store (js/test/build-preset.test.ts pins how it
// is WRITTEN). Everything here runs the real CLI as a subprocess against a real
// built bundle and a real map, because the thing being tested is a workflow —
// "a stack came back from the field carrying a releaseId and nothing else" —
// and a workflow that is only ever exercised through its own internals is a
// workflow nobody has run.
//
// The two store modes must also be a strict ADDITION: the original
// `symbolicate <map>` invocation keeps working byte for byte, which is asserted
// by diffing its stdout against the store mode's rather than by re-describing
// the format.

const script = join(
  dirname(fileURLToPath(import.meta.url)),
  "../scripts/symbolicate.ts",
);

const PROBE = (suffix: string) =>
  "function shoppingListProbe() {\n  return 1;\n}\n" +
  `globalThis.__probeGlobal = shoppingListProbe() + ${suffix};\n`;

function runCli(
  args: string[],
  input = "",
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", script, ...args],
    { input, encoding: "utf8" },
  );
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/**
 * A stack in the shape the vendored quickjs-ng emits, pointing at a REAL
 * position in a real minified bundle: the probe's declaration, located through
 * the one identifier minification cannot rename (a global property). Engines
 * report columns 1-based, so the string index is the column minus one — the
 * exact convention symbolicate-core converts, which is why the fixture states
 * it here instead of pre-subtracting.
 */
function stackInto(outfile: string): string {
  const code = readFileSync(outfile, "utf8");
  const call = /globalThis\.__probeGlobal\s*=\s*([A-Za-z_$][\w$]*)\s*\(/.exec(
    code,
  );
  const minified = call?.[1] ?? "";
  expect(minified).not.toBe("");
  const index = code.indexOf(`function ${minified}(`) + "function ".length;
  return (
    "Error: boom\n" +
    `    at ${minified} (bundle.js:1:${index + 1})\n` +
    "    at <anonymous> (bundle.js:1:1)\n"
  );
}

describe("symbolicate --symbols", () => {
  let dir = "";
  let symbols = "";
  /** Two targets built from ONE entry: identical bytes, so ONE releaseId. */
  let sharedRelease = "";
  let sharedOutfile = "";
  /** A second build whose bytes differ, so its release holds one target. */
  let soloRelease = "";
  let soloOutfile = "";

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "rnw-symcli-"));
    symbols = join(dir, "symbols");
    const entry = join(dir, "entry.ts");
    const alt = join(dir, "alt.ts");
    writeFileSync(entry, PROBE("1"));
    writeFileSync(alt, PROBE("2"));

    sharedOutfile = join(dir, "watch/bundle.js");
    const shared = await buildBundles(
      [
        {
          name: "watch",
          entry,
          outfile: sharedOutfile,
          manifest: { version: 9 },
        },
        { name: "widget", entry, outfile: join(dir, "widget/bundle.js") },
      ],
      { symbols },
    );
    sharedRelease = shared[0]?.releaseId ?? "";

    soloOutfile = join(dir, "solo/bundle.js");
    const solo = await buildBundles(
      [{ name: "app", entry: alt, outfile: soloOutfile }],
      { symbols },
    );
    soloRelease = solo[0]?.releaseId ?? "";
    expect(soloRelease).not.toBe(sharedRelease);
  }, 60_000);

  it("finds the map by releaseId alone when the release holds one target", () => {
    const run = runCli(
      ["--symbols", symbols, "--release", soloRelease],
      stackInto(soloOutfile),
    );
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("at shoppingListProbe (");
    expect(run.stdout).toContain("alt.ts:1:10");
    // The unmappable frame is printed THROUGH, not dropped.
    expect(run.stdout).toContain(
      "at <anonymous> (bundle.js:1:1)   [no mapping]",
    );
    // The map it chose goes to stderr, so stdout stays pipeable as the stack.
    expect(run.stderr).toContain(join(symbols, soloRelease, "app"));
  });

  // The roadmap requirement, stated as a refusal: two bundles share a
  // releaseId whenever their bytes match, and applying the app's map to a
  // widget stack does not error — it answers, wrongly. So the CLI declines.
  it("refuses to guess between two targets of one release, and takes --target", () => {
    const stack = stackInto(sharedOutfile);
    const ambiguous = runCli(
      ["--symbols", symbols, "--release", sharedRelease],
      stack,
    );
    expect(ambiguous.status).toBe(1);
    expect(ambiguous.stderr).toContain("2 targets (watch, widget)");
    expect(ambiguous.stderr).toContain("--target");

    const resolved = runCli(
      ["--symbols", symbols, "--release", sharedRelease, "--target", "widget"],
      stack,
    );
    expect(resolved.status).toBe(0);
    expect(resolved.stdout).toContain("at shoppingListProbe (");
    expect(resolved.stderr).toContain(join(symbols, sharedRelease, "widget"));
  });

  it("lists what the store DOES hold when the release is unknown", () => {
    const run = runCli(
      ["--symbols", symbols, "--release", "0123456789abcdef"],
      stackInto(soloOutfile),
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("no symbols for releaseId 0123456789abcdef");
    // Both releases, so a typo is visibly a typo and an empty store is visibly
    // an upload you never did.
    expect(run.stderr).toContain(sharedRelease);
    expect(run.stderr).toContain(soloRelease);
  });

  // The whole point of the addition is that it changes nothing about the mode
  // that already worked: same map, same stack, same bytes on stdout.
  it("produces exactly what the positional map-path mode produces", () => {
    const stack = stackInto(soloOutfile);
    const positional = runCli([`${soloOutfile}.map`], stack);
    const viaStore = runCli(
      ["--symbols", symbols, "--release", soloRelease],
      stack,
    );
    expect(positional.status).toBe(0);
    expect(viaStore.stdout).toBe(positional.stdout);
  });

  it("rejects a map path and --symbols in the same invocation", () => {
    const run = runCli(
      [`${soloOutfile}.map`, "--symbols", symbols, "--release", soloRelease],
      "",
    );
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("not both");
  });
});

// The diagnostics ring is how a stack actually reaches you: the host records
// every error into an always-on ring (ARCH-13) whose records carry `releaseId`
// and, for a `js.*` record, the runtime's "message\nstack" text in `details`.
// Feeding that document in whole is the difference between symbolicating a
// crash and first hand-extracting a stack out of JSON.
describe("symbolicate --diagnostics", () => {
  let dir = "";
  let symbols = "";
  let ring = "";
  let appRelease = "";
  let widgetRelease = "";

  beforeAll(async () => {
    // realpath, because on macOS tmpdir() is the /var -> /private/var symlink:
    // esbuild resolves the entry to the real path but writes the map beside the
    // unresolved outfile, so the map's `sources` come out as a seven-level
    // ../../.. climb instead of the sibling "../app.ts" this suite asserts.
    dir = realpathSync(mkdtempSync(join(tmpdir(), "rnw-symdiag-")));
    symbols = join(dir, "symbols");
    const appEntry = join(dir, "app.ts");
    const widgetEntry = join(dir, "widget.ts");
    writeFileSync(appEntry, PROBE("1"));
    writeFileSync(widgetEntry, PROBE("2"));

    const appOut = join(dir, "app/bundle.js");
    const widgetOut = join(dir, "widget/bundle.js");
    const built = await buildBundles(
      [
        {
          name: "app",
          entry: appEntry,
          outfile: appOut,
          manifest: { version: 9 },
        },
        { name: "widget", entry: widgetEntry, outfile: widgetOut },
      ],
      { symbols },
    );
    appRelease = built[0]?.releaseId ?? "";
    widgetRelease = built[1]?.releaseId ?? "";

    // The shape `inspectorSnapshot()` posts (src/inspector.ts) — the ring is
    // the `diagnostics` array on it. Two releases in one document is the
    // normal case, not an exotic one: a ring routinely spans an OTA rollback,
    // which is exactly when you are reading it.
    ring = join(dir, "ring.json");
    writeFileSync(
      ring,
      JSON.stringify({
        commits: 12,
        tree: null,
        logs: [],
        errors: [],
        diagnostics: [
          {
            code: "js.uncaught",
            severity: "recoverable",
            subsystem: "js",
            sessionId: "session-1",
            releaseId: appRelease,
            target: "watch",
            timestamp: 1_755_777_600_000,
            details: stackInto(appOut).trim(),
          },
          {
            code: "js.rejection",
            severity: "recoverable",
            subsystem: "js",
            sessionId: "session-1",
            releaseId: widgetRelease,
            target: "widget",
            timestamp: 1_755_777_601_000,
            details: stackInto(widgetOut).trim(),
          },
          {
            code: "ota.saveRejected",
            severity: "info",
            subsystem: "ota",
            sessionId: "session-1",
            releaseId: appRelease,
            target: "watch",
            timestamp: 1_755_777_602_000,
            details: "no space left on device",
          },
          {
            code: "boot.started",
            severity: "info",
            subsystem: "boot",
            sessionId: "session-1",
            target: "watch",
            timestamp: 1_755_777_599_000,
          },
        ],
      }),
    );
  }, 60_000);

  it("resolves every record against its OWN releaseId", () => {
    const run = runCli(["--symbols", symbols, "--diagnostics", ring]);
    expect(run.status).toBe(0);
    // Each record keeps its identity in the output…
    expect(run.stdout).toContain("[recoverable] js.uncaught (js/watch)");
    expect(run.stdout).toContain(`release ${appRelease}`);
    expect(run.stdout).toContain("[recoverable] js.rejection (js/widget)");
    expect(run.stdout).toContain(`release ${widgetRelease}`);
    // …and both stacks are symbolicated, each through its own build's map:
    // the app's frame lands in app.ts, the widget's in widget.ts. One map for
    // the whole document would put both in the same file.
    expect(run.stdout).toContain("at shoppingListProbe (../app.ts:1:10)");
    expect(run.stdout).toContain("at shoppingListProbe (../widget.ts:1:10)");
    // A record whose details are prose, not a stack, is printed as it is.
    expect(run.stdout).toContain("no space left on device");
    // …and one recorded before a bundle loaded says why it cannot be resolved
    // instead of being resolved against a guess.
    expect(run.stdout).toContain("release none");
  });

  it("reads the document from stdin too", () => {
    const run = runCli(
      ["--symbols", symbols, "--diagnostics"],
      readFileSync(ring, "utf8"),
    );
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("at shoppingListProbe (../app.ts:1:10)");
  });

  it("accepts a bare array of records", () => {
    const document = JSON.parse(readFileSync(ring, "utf8")) as {
      diagnostics: unknown[];
    };
    const run = runCli(
      ["--symbols", symbols, "--diagnostics"],
      JSON.stringify(document.diagnostics),
    );
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("at shoppingListProbe (../app.ts:1:10)");
  });

  // Pointing at the wrong store is the likely mistake, and it must not look
  // like success: the records would still print, stacks and all, and only a
  // careful reader would notice none of them had been resolved.
  it("fails when not one stack in the document found symbols", () => {
    const run = runCli([
      "--symbols",
      join(dir, "elsewhere"),
      "--diagnostics",
      ring,
    ]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("none of the 2 stack(s)");
  });

  it("needs a store to read", () => {
    const run = runCli(["--diagnostics", ring]);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("--diagnostics needs --symbols");
  });

  it("rejects a document that is not a diagnostics ring", () => {
    const run = runCli(["--symbols", symbols, "--diagnostics"], '{"logs":[]}');
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("not a diagnostics document");
  });
});
