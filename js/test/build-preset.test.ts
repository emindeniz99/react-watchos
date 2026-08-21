import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { contentHash } from "../esbuild/manifest.mts";
import { buildBundles, watchBuildOptions } from "../esbuild/preset.mts";
import type { SymbolMetadata } from "../esbuild/symbol-store.mts";

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
    // The result reports the manifest's OWN hash, not a second one computed
    // beside it — one FNV-1a per build, or the two could disagree.
    expect(watch?.releaseId).toBe(watch?.manifest?.releaseId);
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

// The fetch shims are injected, and injection is unconditional bundling: a
// bundle whose feature contract has no `network` paid 3,798 B for a fetch it
// can never call (measured on this repo's widget). A runtime gate saves zero
// bytes, so the switch has to be at build time — and it has to keep DEFAULTING
// ON, because a bundle that calls fetch without the shim fails on the watch.
// Both halves of that are asserted here; the probe is `__resolveFetch`, the
// settle entrypoint JSRuntime.swift calls, since it is a global property name
// minification cannot rename.
describe("network shims", () => {
  const ENTRY = "globalThis.__probeGlobal = 1;\n";

  it("injects fetch by default and omits it for a target that opts out", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rnw-net-"));
    const entry = join(dir, "entry.ts");
    writeFileSync(entry, ENTRY);

    const withNet = join(dir, "app.js");
    await buildBundles([{ name: "app", entry, outfile: withNet }]);
    const app = readFileSync(withNet, "utf8");
    expect(app).toContain("__probeGlobal"); // the bundle IS this entry
    expect(app).toContain("__resolveFetch");

    const noNet = join(dir, "widget.js");
    await buildBundles([
      { name: "widget", entry, outfile: noNet, network: false },
    ]);
    const widget = readFileSync(noNet, "utf8");
    expect(widget).toContain("__probeGlobal");
    expect(widget).not.toContain("__resolveFetch");
    // …and the saving is real bytes, not a reshuffle.
    expect(widget.length).toBeLessThan(app.length);

    // The core shims are NOT part of the trade: timers still beat react's
    // module init in a network-less bundle (__fireTimer is the host's
    // callback into them).
    expect(widget).toContain("__fireTimer");
  });

  it("honours the switch on watchBuildOptions too (the dev/hand-assembly path)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rnw-net-watch-"));
    const entry = join(dir, "entry.ts");
    writeFileSync(entry, ENTRY);

    const withNet = join(dir, "with-net.js");
    await build(watchBuildOptions({ entry, outfile: withNet }));
    expect(readFileSync(withNet, "utf8")).toContain("__resolveFetch");

    const noNet = join(dir, "no-net.js");
    await build(watchBuildOptions({ entry, outfile: noNet, network: false }));
    expect(readFileSync(noNet, "utf8")).not.toContain("__resolveFetch");
  });
});

// Dev-only wiring (the remote inspector is the case in hand) has to leave the
// SHIPPED bundle, and only a build-time gate can do that: a static import keeps
// its module alive however dead the call site is, which is how src/inspector.ts
// kept shipping 1,307 B behind a runtime `if (globalThis.__inspectorUrl)`. The
// pairing below is the contract — a dev build keeps it, a shipped build drops
// it AND drops the module behind it — and `NODE_ENV` cannot express it, since
// it is "production" in both (React's dev bundle is too heavy for the watch).
describe("dev define", () => {
  // `devOnlyProbe` is reachable ONLY from the guarded branch, so its survival
  // is exactly the question "did the dead branch take its module with it?".
  const DEV_FIXTURE =
    "function devOnlyProbe() {\n  globalThis.__inspected = 1;\n}\n" +
    "globalThis.__probeGlobal = 1;\n" +
    "if (process.env.REACT_WATCH_DEV) devOnlyProbe();\n";

  it("keeps dev-only code out of a shipped bundle and in a dev one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rnw-dev-define-"));
    const entry = join(dir, "entry.ts");
    writeFileSync(entry, DEV_FIXTURE);

    // buildBundles = the shipping entry: gone, and no raw process.env read
    // left behind to crash QuickJS.
    const shipped = join(dir, "shipped.js");
    await buildBundles([{ name: "app", entry, outfile: shipped }]);
    const shippedCode = readFileSync(shipped, "utf8");
    expect(shippedCode).toContain("__probeGlobal"); // the bundle IS this entry
    expect(shippedCode).not.toContain("__inspected");
    expect(shippedCode).not.toContain("process.env.REACT_WATCH_DEV");

    // watchBuildOptions = the dev loop: kept.
    const dev = join(dir, "dev.js");
    await build(watchBuildOptions({ entry, outfile: dev }));
    const devCode = readFileSync(dev, "utf8");
    expect(devCode).toContain("__inspected");
    expect(devCode).not.toContain("process.env.REACT_WATCH_DEV");

    // …and the derivation is a DEFAULT, not a law: a minified bundle you still
    // want to inspect asks for it, and an unminified one can ship.
    const inspectable = join(dir, "inspectable.js");
    await buildBundles([{ name: "app", entry, outfile: inspectable }], {
      dev: true,
    });
    expect(readFileSync(inspectable, "utf8")).toContain("__inspected");

    const strippedDev = join(dir, "stripped.js");
    await build(watchBuildOptions({ entry, outfile: strippedDev, dev: false }));
    expect(readFileSync(strippedDev, "utf8")).not.toContain("__inspected");
  });

  it("does not let the shipping default override an explicit unminified build", async () => {
    // `buildBundles({ minify: false })` is documented as "give me the frames
    // back out of a shipped bundle" — it must follow minify into dev, not
    // silently pin dev off.
    const dir = mkdtempSync(join(tmpdir(), "rnw-dev-unmin-"));
    const entry = join(dir, "entry.ts");
    writeFileSync(entry, DEV_FIXTURE);
    const outfile = join(dir, "unminified.js");
    await buildBundles([{ name: "app", entry, outfile }], { minify: false });
    expect(readFileSync(outfile, "utf8")).toContain("__inspected");
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

// Source maps are ON by default, `keepNames` is OFF, and the pairing is the
// point: minification costs you the component name in a stack, and the two
// options buy it back at opposite prices — the map for free at rest (it is
// `external`, so not one shipped byte moves), keepNames for +17 KB in the
// bundle. Pinning both defaults keeps a flip visible: turning the map off
// would silently make every shipped stack unreadable forever (you cannot
// symbolicate a build whose map was never written), and turning keepNames on
// would silently fatten every bundle.
describe("source map + keepNames defaults", () => {
  const PROBE_FIXTURE =
    "function shoppingListProbe() {\n  return 1;\n}\n" +
    "globalThis.__probeGlobal = shoppingListProbe() + 1;\n";

  it("writes a map beside the bundle without touching the shipped bytes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rnw-map-"));
    const entry = join(dir, "entry.ts");
    writeFileSync(entry, PROBE_FIXTURE);

    const mapped = join(dir, "mapped.js");
    await buildBundles([{ name: "app", entry, outfile: mapped }]);
    expect(existsSync(`${mapped}.map`)).toBe(true);

    const code = readFileSync(mapped, "utf8");
    // "external", not "linked": no comment is appended, so the bytes the watch
    // runs — and the OTA releaseId hashed from exactly those bytes — are the
    // same with the map on or off. That equality is the whole reason this can
    // be a default.
    expect(code).not.toContain("sourceMappingURL");
    const bare = join(dir, "bare.js");
    await buildBundles([{ name: "app", entry, outfile: bare }], {
      sourcemap: false,
    });
    expect(existsSync(`${bare}.map`)).toBe(false);
    expect(readFileSync(bare, "utf8")).toBe(code);
    // …stated the way the OTA manifest states it, since that hash IS the
    // releaseId a watch compares against.
    expect(contentHash(readFileSync(bare, "utf8"))).toBe(
      contentHash(readFileSync(mapped, "utf8")),
    );
  });

  // The map is only worth defaulting on if it actually resolves a MINIFIED
  // frame back to a name — which is what a crash reporter (or js/scripts/
  // symbolicate.ts) does with the `line:col` the vendored quickjs-ng reports.
  it("resolves a minified name back to the original through the map", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rnw-map-name-"));
    const entry = join(dir, "entry.ts");
    writeFileSync(entry, PROBE_FIXTURE);
    const outfile = join(dir, "bundle.js");
    await buildBundles([{ name: "app", entry, outfile }]);

    // Locate the probe the way you would locate a real frame: through the
    // one identifier minification cannot rename (a global property), then the
    // declaration of the local it calls. Searching for the first `function `
    // in the file would land in the injected shims instead.
    const code = readFileSync(outfile, "utf8");
    const call = /globalThis\.__probeGlobal\s*=\s*([A-Za-z_$][\w$]*)\s*\(/.exec(
      code,
    );
    expect(call).not.toBeNull();
    const minifiedName = call?.[1] ?? "";
    const at = code.indexOf(`function ${minifiedName}(`) + "function ".length;
    expect(at).toBeGreaterThan("function ".length - 1);
    const tracer = new TraceMap(
      JSON.parse(readFileSync(`${outfile}.map`, "utf8")),
    );
    // Everything is on line 1 after minification; source-map columns are
    // 0-based, which is exactly the string index here.
    const position = originalPositionFor(tracer, { line: 1, column: at });
    expect(position.source).toContain("entry.ts");
    expect(position.name).toBe("shoppingListProbe");
  });

  // The CLI has its own flag resolution (bin/react-watchos.cts), so the API
  // defaults above do not prove the flags reach it — same reason `--no-minify`
  // is spawned for real rather than trusted.
  it("exposes both toggles on the CLI", () => {
    const dir = mkdtempSync(join(tmpdir(), "rnw-map-cli-"));
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

    const dflt = join(dir, "default.js");
    expect(runBuild(dflt)).not.toContain("shoppingListProbe");
    expect(existsSync(`${dflt}.map`)).toBe(true);

    const bare = join(dir, "bare.js");
    runBuild(bare, "--no-sourcemap");
    expect(existsSync(`${bare}.map`)).toBe(false);

    const kept = join(dir, "kept.js");
    expect(runBuild(kept, "--keep-names")).toContain("shoppingListProbe");
  }, 60_000);

  it("keeps names only when asked", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rnw-keepnames-"));
    const entry = join(dir, "entry.ts");
    writeFileSync(entry, PROBE_FIXTURE);

    const kept = join(dir, "kept.js");
    await buildBundles([{ name: "app", entry, outfile: kept }], {
      keepNames: true,
    });
    const keptCode = readFileSync(kept, "utf8");
    expect(keptCode).toContain("__probeGlobal"); // the bundle IS this entry
    expect(keptCode).toContain("shoppingListProbe"); // …minified, names intact

    // …and the default does not pay for that (the assertion the +17 KB rides
    // on; the minification suite above states the same from the other side).
    const dflt = join(dir, "default.js");
    await buildBundles([{ name: "app", entry, outfile: dflt }]);
    expect(readFileSync(dflt, "utf8")).not.toContain("shoppingListProbe");
  });
});

// A map only helps if it is still there when the stack arrives, and the one
// esbuild writes beside the outfile is overwritten by the next build. The
// opt-in store is what survives, keyed by the identity the stack itself carries
// (`releaseId`), and what is pinned here is the LAYOUT — because that layout is
// a contract between two separate programs: `buildBundles` writes it and
// `pnpm symbolicate --symbols` reads it (js/test/symbolicate-cli.test.ts drives
// the other end).
describe("symbol store", () => {
  const PROBE_FIXTURE =
    "function shoppingListProbe() {\n  return 1;\n}\n" +
    "globalThis.__probeGlobal = shoppingListProbe() + 1;\n";

  const metadataOf = (dir: string): SymbolMetadata =>
    JSON.parse(readFileSync(join(dir, "metadata.json"), "utf8"));

  // Both targets are built from the SAME entry with the same options, so their
  // bytes — and therefore their releaseId — are identical. That is not a
  // contrived case: it is what "one source tree, two bundles" produces whenever
  // the two happen to agree, and it is the case that decides the layout. Keyed
  // by release alone, the widget's stack would resolve through whichever map
  // was written last and come back CONFIDENTLY WRONG rather than fail.
  it("stores bundle + map + metadata under <releaseId>/<target>", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rnw-symbols-"));
    const entry = join(dir, "entry.ts");
    writeFileSync(entry, PROBE_FIXTURE);
    const symbols = join(dir, "symbols");
    const watchOut = join(dir, "watch/app.js");
    const widgetOut = join(dir, "widget/bundle.js");

    const results = await buildBundles(
      [
        { name: "watch", entry, outfile: watchOut, manifest: { version: 7 } },
        { name: "widget", entry, outfile: widgetOut },
      ],
      { symbols },
    );

    const releaseId = contentHash(readFileSync(watchOut, "utf8"));
    // The identity is the OTA one, not a new one invented for the store.
    expect(results[0]?.manifest?.releaseId).toBe(releaseId);
    expect(results.map((r) => r.releaseId)).toEqual([releaseId, releaseId]);
    // …and it is reported for the widget too, which stamps no manifest at all.
    expect(readdirSync(symbols)).toEqual([releaseId]);
    expect(readdirSync(join(symbols, releaseId)).sort()).toEqual([
      "watch",
      "widget",
    ]);

    const watchDir = join(symbols, releaseId, "watch");
    expect(results[0]?.symbols).toBe(watchDir);
    // The bundle is kept beside the map: re-hashing it is how you confirm the
    // directory name really describes these bytes.
    expect(readFileSync(join(watchDir, "app.js"), "utf8")).toBe(
      readFileSync(watchOut, "utf8"),
    );
    expect(readFileSync(join(watchDir, "app.js.map"), "utf8")).toBe(
      readFileSync(`${watchOut}.map`, "utf8"),
    );
    expect(metadataOf(watchDir)).toEqual({
      target: "watch",
      bundle: "app.js", // the real outfile name, not a hardcoded bundle.js
      map: "app.js.map",
      bytes: statSync(watchOut).size,
      releaseId,
      minify: true, // buildBundles ships
      keepNames: false,
      sourcemap: true,
    });

    // The widget's entry is its OWN directory with its OWN bundle name.
    const widgetDir = join(symbols, releaseId, "widget");
    expect(metadataOf(widgetDir)).toMatchObject({
      target: "widget",
      bundle: "bundle.js",
      map: "bundle.js.map",
      releaseId,
    });
    expect(readFileSync(join(widgetDir, "bundle.js"), "utf8")).toBe(
      readFileSync(widgetOut, "utf8"),
    );
  });

  // Opt-in means opt-in: a build that did not ask for a store must not leave
  // one behind, and must behave exactly as it did before the option existed.
  it("writes nothing when `symbols` is absent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rnw-symbols-off-"));
    const entry = join(dir, "entry.ts");
    writeFileSync(entry, PROBE_FIXTURE);
    const outfile = join(dir, "bundle.js");

    const [result] = await buildBundles([{ name: "app", entry, outfile }]);

    expect(existsSync(outfile)).toBe(true);
    expect(result?.symbols).toBeUndefined();
    expect(readdirSync(dir).sort()).toEqual([
      "bundle.js",
      "bundle.js.map",
      "entry.ts",
    ]);
    // …and this build stamped no manifest either, so nothing hashed its bytes:
    // the FNV-1a is a measured 55 ms on a 628 KB bundle and is computed only
    // when something reads it (the manifest, or the store).
    expect(result?.releaseId).toBeUndefined();
  });

  // The metadata's job is to answer "why is this frame unreadable?" weeks
  // later, so the three settings that decide that are recorded from the build
  // that actually ran — and `map: null` says out loud that no map was kept,
  // rather than leaving the reader to hunt for a file that never existed.
  it("records the build settings the stack's readability depends on", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rnw-symbols-opts-"));
    const entry = join(dir, "entry.ts");
    writeFileSync(entry, PROBE_FIXTURE);
    const symbols = join(dir, "symbols");
    const outfile = join(dir, "bundle.js");

    const [result] = await buildBundles([{ name: "app", entry, outfile }], {
      symbols,
      minify: false,
      keepNames: true,
      sourcemap: false,
    });

    const entryDir = result?.symbols ?? "";
    expect(metadataOf(entryDir)).toMatchObject({
      map: null,
      minify: false,
      keepNames: true,
      sourcemap: false,
    });
    expect(readdirSync(entryDir).sort()).toEqual([
      "bundle.js",
      "metadata.json",
    ]);
  });

  // The CLI has its own flag plumbing (bin/react-watchos.cts), so the API test
  // above does not prove `--symbols` reaches the preset — the same reason
  // `--no-minify` and `--no-sourcemap` are spawned for real rather than trusted.
  it("exposes --symbols on the CLI", () => {
    const dir = mkdtempSync(join(tmpdir(), "rnw-symbols-cli-"));
    const entry = join(dir, "entry.ts");
    writeFileSync(entry, PROBE_FIXTURE);
    const symbols = join(dir, "symbols");
    const outfile = join(dir, "dist/bundle.js");

    execFileSync(
      process.execPath,
      [
        "--experimental-strip-types",
        join(
          dirname(fileURLToPath(import.meta.url)),
          "../bin/react-watchos.cts",
        ),
        "build",
        "--entry",
        entry,
        "--outfile",
        outfile,
        "--symbols",
        symbols,
      ],
      { stdio: "pipe" },
    );

    const releaseId = contentHash(readFileSync(outfile, "utf8"));
    // `build` names its single target "app"; the manifest it stamps beside the
    // outfile and the store directory must agree on the id.
    expect(
      JSON.parse(readFileSync(join(dir, "dist/manifest.json"), "utf8"))
        .releaseId,
    ).toBe(releaseId);
    expect(metadataOf(join(symbols, releaseId, "app"))).toMatchObject({
      target: "app",
      bundle: "bundle.js",
      releaseId,
    });

    // …and a build without the flag still leaves no store (the default path).
    const bare = join(dir, "bare/bundle.js");
    execFileSync(
      process.execPath,
      [
        "--experimental-strip-types",
        join(
          dirname(fileURLToPath(import.meta.url)),
          "../bin/react-watchos.cts",
        ),
        "build",
        "--entry",
        entry,
        "--outfile",
        bare,
      ],
      { stdio: "pipe" },
    );
    expect(readdirSync(join(symbols, releaseId)).sort()).toEqual(["app"]);
  }, 60_000);
});
