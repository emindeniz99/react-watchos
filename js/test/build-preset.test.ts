import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { contentHash } from "../esbuild/manifest.mts";
import { buildBundles, watchBuildOptions } from "../esbuild/preset.mts";

// The batteries-included multi-target build: a consumer with a watch bundle +
// a widget bundle calls this once instead of copying the esbuild boilerplate
// per target. The contract that matters: every target is built through the
// preset, and `manifest` stamps OTA `manifest.json` next to *that* bundle only
// (the app bundle is OTA'd; the widget bundle is shipped) — so a drift here
// would silently leave a widget un-OTA'd or an app bundle un-stamped.
describe("buildBundles", () => {
  it("builds every target and stamps a manifest only where asked", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rnw-build-"));
    const entry = join(dir, "entry.ts");
    writeFileSync(entry, "export const x = 1;\n");
    // A non-default outfile name (app.js, not bundle.js) — the manifest must
    // still track THIS file, not a hardcoded bundle.js (regression guard).
    const watchOut = join(dir, "watch/app.js");
    const widgetOut = join(dir, "widget/bundle.js");

    const results = await buildBundles([
      {
        name: "watch",
        entry,
        outfile: watchOut,
        manifest: { version: 2, requiredFeatures: ["core"] },
      },
      { name: "widget", entry, outfile: widgetOut },
    ]);

    expect(existsSync(watchOut)).toBe(true);
    expect(existsSync(widgetOut)).toBe(true);
    // Manifest next to the watch bundle, not the widget.
    expect(existsSync(join(dir, "watch/manifest.json"))).toBe(true);
    expect(existsSync(join(dir, "widget/manifest.json"))).toBe(false);

    const watch = results.find((r) => r.name === "watch");
    expect(watch?.manifest?.version).toBe(2);
    expect(watch?.manifest?.requiredFeatures).toEqual(["core"]);
    // `bundle` + `releaseId` track the actual outfile (app.js), not bundle.js.
    expect(watch?.manifest?.bundle).toBe("app.js");
    expect(watch?.manifest?.releaseId).toBe(
      contentHash(readFileSync(watchOut, "utf8")),
    );
    expect(results.find((r) => r.name === "widget")?.manifest).toBeUndefined();
  });

  it("rejects an empty target list (a no-op build is a mistake)", async () => {
    await expect(buildBundles([])).rejects.toThrow(/non-empty/);
  });

  // The npm tarball ships this package's .tsx as SOURCE with no tsconfig.json,
  // and esbuild's per-file tsconfig discovery stops at the package boundary —
  // so on a registry install the renderer's own JSX would fall back to the
  // CLASSIC transform (bare `React.createElement`) and crash the watch app at
  // boot with "ReferenceError: React is not defined" (found by the first real
  // registry consumer, ctrl-a-remote). Workspace installs mask the bug: the
  // pnpm symlink realpaths into js/, where tsconfig.json says `react-jsx`. The
  // preset must pin the automatic runtime so JSX never depends on discovery.
  it("compiles JSX via the automatic runtime even with no discoverable tsconfig", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rnw-jsx-")); // no tsconfig above
    const entry = join(dir, "entry.tsx");
    writeFileSync(entry, 'export const el = <label text="hi" />;\n');
    const outfile = join(dir, "bundle.js");
    // nodePaths: the tmp entry can't resolve react/jsx-runtime on its own.
    const nodeModules = fileURLToPath(
      new URL("../node_modules", import.meta.url),
    );
    await build(
      watchBuildOptions({ entry, outfile, nodePaths: [nodeModules] }),
    );
    expect(readFileSync(outfile, "utf8")).not.toContain("React.createElement");
  });

  // QuickJS has no `process`, so a `process.env.BUNDLE_VERSION` that survives to
  // runtime crashes the whole bundle at load — the exact thing that only bites
  // the shipped consumer path (the in-repo build + Node tests both have it
  // defined). It must be statically replaced, and from manifest.version so the
  // two stay in lockstep.
  it("bakes BUNDLE_VERSION from manifest.version; never leaves a raw process.env read", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rnw-bv-"));
    const entry = join(dir, "entry.ts");
    writeFileSync(entry, "export const v = process.env.BUNDLE_VERSION;\n");

    const appOut = join(dir, "app.js");
    await buildBundles([
      { name: "app", entry, outfile: appOut, manifest: { version: 4 } },
    ]);
    const app = readFileSync(appOut, "utf8");
    expect(app).not.toContain("process.env.BUNDLE_VERSION"); // would crash in QuickJS
    expect(app).toContain('"4"'); // == manifest.version, not a hardcoded default

    // A target with NO manifest still gets the preset default, so any bundle
    // that happens to read BUNDLE_VERSION can't crash either.
    const widgetOut = join(dir, "widget.js");
    await buildBundles([{ name: "widget", entry, outfile: widgetOut }]);
    expect(readFileSync(widgetOut, "utf8")).not.toContain(
      "process.env.BUNDLE_VERSION",
    );
  });
});

// The two defaults DISAGREE on purpose, and this is what pins the disagreement:
// `buildBundles` ships (minified), `watchBuildOptions` is what `react-watchos
// dev` builds the live-reload bundle with (readable, because minification is
// what costs you the USER component names in a stack). See the `minify` JSDoc
// in ../esbuild/preset.mts for the measured bytes/heap/boot. A silent flip
// either way is a real regression — a fatter ship, or a dev loop that traces
// `at t`.
//
// The probe is a FUNCTION NAME, because that is exactly what plain `minify`
// destroys (it renames locals; `keepNames` is deliberately off). `__probeGlobal`
// is asserted alongside it in every build so the test cannot pass vacuously by
// building an empty or wrong bundle.
describe("minification defaults", () => {
  const PROBE_FIXTURE =
    "function shoppingListProbe() {\n  return 1;\n}\n" +
    "globalThis.__probeGlobal = shoppingListProbe() + 1;\n";

  it("buildBundles minifies by default; watchBuildOptions does not", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rnw-min-"));
    const entry = join(dir, "entry.ts");
    writeFileSync(entry, PROBE_FIXTURE);

    const shipped = join(dir, "shipped.js");
    await buildBundles([{ name: "shipped", entry, outfile: shipped }]);
    const shippedCode = readFileSync(shipped, "utf8");
    expect(shippedCode).toContain("__probeGlobal"); // the bundle IS this entry
    expect(shippedCode).not.toContain("shoppingListProbe"); // …and it is minified

    const optedOut = join(dir, "opted-out.js");
    await buildBundles([{ name: "optedOut", entry, outfile: optedOut }], {
      minify: false,
    });
    expect(readFileSync(optedOut, "utf8")).toContain("shoppingListProbe");

    const watched = join(dir, "watched.js");
    await build(watchBuildOptions({ entry, outfile: watched }));
    expect(readFileSync(watched, "utf8")).toContain("shoppingListProbe");
  });

  // `--no-minify` is a separately declared option rather than parseArgs'
  // `allowNegative` pair (that pairing is last-flag-wins; the opt-out has to
  // win in either order), which means the CLI's flag resolution is real code
  // that can rot. Spawn the actual bin (no dist-node
  // build needed: Node strips the .cts types itself, the same way the codegen
  // drift test runs the generator).
  it("the CLI ships minified, and --no-minify opts out (beating --minify)", () => {
    const dir = mkdtempSync(join(tmpdir(), "rnw-cli-"));
    const entry = join(dir, "entry.ts");
    writeFileSync(entry, PROBE_FIXTURE);
    const bin = join(
      dirname(fileURLToPath(import.meta.url)),
      "../bin/react-watchos.cts",
    );
    const runBuild = (outfile: string, ...flags: string[]): string => {
      execFileSync(
        process.execPath,
        [
          "--experimental-strip-types",
          bin,
          "build",
          "--entry",
          entry,
          "--outfile",
          outfile,
          ...flags,
        ],
        { stdio: "pipe" },
      );
      return readFileSync(outfile, "utf8");
    };

    const shipped = runBuild(join(dir, "shipped.js"));
    expect(shipped).toContain("__probeGlobal");
    expect(shipped).not.toContain("shoppingListProbe");

    expect(runBuild(join(dir, "plain.js"), "--no-minify")).toContain(
      "shoppingListProbe",
    );
    // `--minify` must still PARSE (dropping it would hard-fail every existing
    // script with ERR_PARSE_ARGS_UNKNOWN_OPTION), and lose to `--no-minify`
    // whatever the order — an escape hatch appended to a wrapper's fixed argv
    // has to work.
    expect(runBuild(join(dir, "both.js"), "--minify", "--no-minify")).toContain(
      "shoppingListProbe",
    );
    expect(runBuild(join(dir, "affirm.js"), "--minify")).not.toContain(
      "shoppingListProbe",
    );
  }, 60_000);

  // The third default, and the one no other test reaches: `dev` does not read
  // `buildFlags`' resolution — it hardcodes `minify: false` at its own call
  // site. Without this, changing that one word to `f.minify` would silently
  // minify the live-reload bundle with the whole suite still green, which is
  // exactly the drift the split was meant to prevent. `--port 0` lets esbuild
  // pick a free port, so this cannot collide in CI.
  it("dev serves an unminified live-reload bundle", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rnw-dev-"));
    const entry = join(dir, "entry.ts");
    writeFileSync(entry, PROBE_FIXTURE);
    const outfile = join(dir, "dev", "bundle.js");
    const child = spawn(
      process.execPath,
      [
        "--experimental-strip-types",
        join(
          dirname(fileURLToPath(import.meta.url)),
          "../bin/react-watchos.cts",
        ),
        "dev",
        "--entry",
        entry,
        "--outfile",
        outfile,
        "--port",
        "0",
      ],
      { stdio: "pipe" },
    );
    try {
      // esbuild's ctx.watch() writes the outfile; poll rather than parse
      // stdout — and poll on CONTENT, not existence: the write is a
      // truncate+write rather than an atomic rename, so the path exists for a
      // moment while the file is still empty, and an existence-gated read that
      // lands in that window fails on emptiness instead of on minification.
      let code = "";
      for (let i = 0; i < 60 && !code.includes("__probeGlobal"); i++) {
        await new Promise((r) => setTimeout(r, 250));
        if (existsSync(outfile)) code = readFileSync(outfile, "utf8");
      }
      expect(code).toContain("__probeGlobal"); // the bundle IS this entry
      expect(code).toContain("shoppingListProbe"); // …and it is NOT minified
    } finally {
      child.kill("SIGKILL");
    }
  }, 60_000);
});
