#!/usr/bin/env node
"use strict";

// react-watchos CLI.
//
// `react-watchos scaffold [--force]` generates the @main Swift glue the
// config plugin can't generate: targets/watch/WatchApp.swift (the watch app) and,
// when the widget target is enabled, targets/widget/ReactWidgets.swift (the
// @main WidgetBundle). It reads app.json and reuses the plugin's resolveOptions,
// so the struct names + App Group match your plugin config.
//
// `react-watchos build|dev|inspector` are the consumer dev loop (M11): the
// QuickJS-correct bundle build, the live-reload server a DEBUG watch build
// polls, and the remote inspector UI — all wrapping the published preset, so
// a registry install gets the same loop the demo uses.
//
// There is intentionally no `prebuild` command: the config plugin links the
// SwiftPM host + merges the target Info.plists during `expo prebuild` itself
// (see plugin/withNativeWiring.js), so `expo prebuild` is all you run.

const fs = require("node:fs");
const path = require("node:path");
const { parseArgs } = require("node:util");

/**
 * Parse the shared build/dev flags.
 */
function buildFlags(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      entry: { type: "string" },
      outfile: { type: "string", default: path.join("dist", "bundle.js") },
      asset: { type: "string" },
      // `build` ships, so it minifies by default (see the preset's `minify`
      // JSDoc for the measured bytes/heap/boot and the one cost). parseArgs is
      // strict, so the escape hatch has to be declared — and it is declared
      // SEPARATELY rather than as parseArgs' `allowNegative` pair, because that
      // pairing is last-flag-wins while the opt-out has to win in either order
      // (see the resolution below); `--minify` stays declared as the explicit
      // affirmative so scripts already passing it don't hard-fail with
      // ERR_PARSE_ARGS_UNKNOWN_OPTION for asking for what they now get anyway.
      // Both are declared for parse-ACCEPTANCE only — the resolution below is
      // the single source of truth, so neither carries a default here.
      minify: { type: "boolean" },
      "no-minify": { type: "boolean" },
      // The map is written BESIDE the outfile and never referenced from it
      // (`sourcemap: "external"`), so it changes no shipped byte and no OTA
      // releaseId — it is on by default and `--no-sourcemap` exists for the
      // pipeline that refuses to produce an artifact it will not ship.
      "no-sourcemap": { type: "boolean" },
      // The affirmative, because this one costs bytes (+17 KB measured): the
      // map recovers the same names at rest, so pay in the bundle only when
      // whatever reads your stacks cannot symbolicate.
      "keep-names": { type: "boolean" },
      // The fetch/Headers/AbortController shims ship by default — a bundle
      // that calls fetch without them fails at runtime, so the safe default is
      // to include them. `--no-network` is for the bundle whose contract has no
      // network (a widget extension: shared storage + timelines), worth -3,798 B
      // measured. Negative-only: there is nothing to affirm, it is the default.
      "no-network": { type: "boolean" },
      // Opt-in symbol store: keep this build's bundle + map under
      // <dir>/<releaseId>/<target>/ so a stack that comes back from the field
      // carrying only a releaseId can still find the map that reads it.
      // Affirmative-only and absent by default — writing artifacts nobody asked
      // for is not a default, and `releaseId` is the only key (never a second
      // identifier). Resolve one later with `symbolicate --symbols <dir>`.
      symbols: { type: "string" },
      version: { type: "string", default: "1" },
      host: { type: "string", default: process.env.DEV_HOST ?? "127.0.0.1" },
      port: { type: "string", default: process.env.DEV_PORT ?? "8788" },
    },
  });
  if (!values.entry) {
    console.error(
      "[react-watchos] --entry is required (your watch JS entry, e.g. watch-ui/entry.tsx)",
    );
    process.exit(1);
  }
  // Re-spread so the narrowed `entry: string` (the exit above is `never`)
  // reaches the callers' types, not the optional parseArgs shape.
  return {
    ...values,
    entry: values.entry,
    // `--no-minify` beats `--minify` whatever the order, so the escape hatch
    // stays reachable when it is appended to a wrapper script's fixed argv.
    minify: !values["no-minify"],
    sourcemap: !values["no-sourcemap"],
    keepNames: values["keep-names"] === true,
    network: !values["no-network"],
  };
}

/** One-shot bundle build via the published preset (+ OTA manifest stamp). */
async function build(args: string[]) {
  const f = buildFlags(args);
  const { buildBundles } = await import("../esbuild/preset.mts");
  const results = await buildBundles(
    [
      {
        entry: f.entry,
        outfile: f.outfile,
        name: "app",
        manifest: { version: Number(f.version) },
        network: f.network,
      },
    ],
    {
      minify: f.minify,
      sourcemap: f.sourcemap,
      keepNames: f.keepNames,
      // Spread rather than passed as `symbols: undefined`: absent must mean
      // "behave exactly as before", and an explicit undefined would be one
      // more thing the preset has to defend against.
      ...(f.symbols ? { symbols: f.symbols } : {}),
    },
  );
  for (const r of results) {
    console.log(
      `[build] ${r.outfile} (${r.sizeKB} KB)` +
        (f.sourcemap ? ` + ${path.basename(r.outfile)}.map` : ""),
    );
    if (r.symbols) console.log(`[build] symbols -> ${r.symbols}`);
  }
  if (f.asset) {
    fs.mkdirSync(path.dirname(f.asset), { recursive: true });
    fs.copyFileSync(f.outfile, f.asset);
    console.log(`[build] copied to ${f.asset}`);
  }
}

/** Live-reload dev server: rebuild on change, serve the outfile's directory.
 *  A DEBUG watch build polls <host>:<port>/bundle.js every 2s and hot-restarts
 *  its QuickJS runtime when the bytes change (the polling contract; override
 *  the URL with the ReactWatchDevServerURL Info.plist key). */
async function dev(args: string[]) {
  const f = buildFlags(args);
  let context: typeof import("esbuild").context;
  try {
    ({ context } = await import("esbuild"));
  } catch (err) {
    if (
      err instanceof Error &&
      "code" in err &&
      // ERR_MODULE_NOT_FOUND from `import()`; MODULE_NOT_FOUND from the
      // require() the compiled CJS bundle (dist-node/) lowers it to.
      ((err as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND" ||
        (err as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND")
    ) {
      console.error(
        "[react-watchos] dev needs esbuild installed (npm i -D esbuild).",
      );
      process.exit(1);
    }
    throw err;
  }
  const { watchBuildOptions } = await import("../esbuild/preset.mts");
  const ctx = await context(
    // Stated, not inherited: the live-reload bundle is the one you read stack
    // traces out of, so its readability is this call site's contract and not a
    // default that could follow `buildBundles` the next time shipping wins an
    // argument. `build` (which ships) minifies; `dev` does not.
    watchBuildOptions({
      entry: f.entry,
      outfile: f.outfile,
      minify: false,
      sourcemap: f.sourcemap,
    }),
  );
  await ctx.watch();
  const { hosts, port } = await ctx.serve({
    servedir: path.dirname(f.outfile),
    host: f.host,
    port: Number(f.port),
  });
  const bundleName = path.basename(f.outfile);
  console.log(
    `dev server: http://${hosts[0] ?? f.host}:${port}/${bundleName} (live reload)\n` +
      "DEBUG watch builds poll this URL and hot-restart on change.",
  );
}

/** Remote inspector UI (tree + logs + errors posted by a DEBUG watch build). */
async function inspector(args: string[]) {
  const { values } = parseArgs({
    args,
    options: { port: { type: "string" } },
  });
  if (values.port) process.env.INSPECTOR_PORT = values.port;
  await import("./inspector-server.mts"); // listens on import
}

/** Generate the watch app's Swift entry point, parameterized to match the
 *  plugin's resolved app.json config so the App Group + name always agree. */
function scaffold(args: string[]) {
  const projectRoot = process.cwd();
  const force = args.includes("--force");
  const appJsonPath = path.join(projectRoot, "app.json");
  if (!fs.existsSync(appJsonPath)) {
    console.error(`[scaffold] no app.json in ${projectRoot}`);
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(appJsonPath, "utf8")).expo ?? {};
  const plugin = require("../plugin/index.cts");
  const entry = (config.plugins ?? []).find(
    (p: unknown) => (Array.isArray(p) ? p[0] : p) === "react-watchos",
  );
  if (!entry) {
    console.error(
      "[scaffold] add the `react-watchos` plugin to app.json first.",
    );
    process.exit(1);
  }
  const options = Array.isArray(entry) ? (entry[1] ?? {}) : {};
  const opts = plugin.resolveOptions(config, options);

  const {
    watchAppSwift,
    widgetBundleSwift,
  } = require("../plugin/scaffold.cts");

  // The watch app's @main App (always) and, when the widget target is enabled,
  // the @main WidgetBundle — both thin consumers of the package, parameterized
  // to match the plugin's resolved App Group / name.
  writeGlue(
    projectRoot,
    path.join("targets", plugin.WATCH_DIR, "WatchApp.swift"),
    watchAppSwift({ name: opts.name, appGroupId: opts.appGroup }),
    force,
    `App Group ${opts.appGroup}`,
  );
  if (opts.widget) {
    writeGlue(
      projectRoot,
      path.join("targets", plugin.WIDGET_DIR, "ReactWidgets.swift"),
      widgetBundleSwift({ name: opts.name, appGroupId: opts.appGroup }),
      force,
      "edit to add a widget per registered `kind`",
    );
    console.log(
      "[scaffold] next: write your widget JS entry (registerWidget, no UI mount) " +
        "and build it with the preset to targets/widget/assets/bundle.js — see the README.",
    );
  }
}

/**
 * Write one scaffolded file, refusing to clobber an edited one without --force.
 */
function writeGlue(
  projectRoot: string,
  relPath: string,
  contents: string,
  force: boolean,
  note: string,
) {
  const file = path.join(projectRoot, relPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file) && !force) {
    console.error(
      `[scaffold] ${relPath} already exists (pass --force to overwrite)`,
    );
    process.exit(1);
  }
  fs.writeFileSync(file, contents);
  console.log(`[scaffold] wrote ${relPath} (${note})`);
}

const [command, ...rest] = process.argv.slice(2);
switch (command) {
  case "scaffold":
    scaffold(rest);
    break;
  case "build":
    build(rest).catch(fail);
    break;
  case "dev":
    dev(rest).catch(fail);
    break;
  case "inspector":
    inspector(rest).catch(fail);
    break;
  default:
    console.error(
      "react-watchos\n\n" +
        "Usage:\n" +
        "  react-watchos scaffold [--force]\n" +
        "      Generate the @main Swift glue from your app.json plugin config:\n" +
        "      targets/watch/WatchApp.swift, plus targets/widget/ReactWidgets.swift\n" +
        "      when the widget target is enabled. Then run `expo prebuild` — the\n" +
        "      plugin links the SwiftPM packages + merges the Info.plists.\n\n" +
        "  react-watchos build --entry <file> [--outfile dist/bundle.js]\n" +
        "                      [--asset <copy-to>] [--no-minify] [--version <n>]\n" +
        "                      [--no-sourcemap] [--keep-names] [--no-network]\n" +
        "                      [--symbols <dir>]\n" +
        "      One-shot QuickJS-correct bundle build (published esbuild preset)\n" +
        "      + OTA manifest stamp next to the outfile. Minified by default\n" +
        "      (~-68% bytes, a third less QuickJS heap); --no-minify keeps the\n" +
        "      component names in stack traces at that cost. A source map is\n" +
        "      written beside the outfile by default and referenced from\n" +
        "      nowhere, so it costs the shipped bytes nothing — resolve a stack\n" +
        "      later with `react-watchos`'s symbolicate script. --keep-names\n" +
        "      instead bakes the names into the bundle (+17 KB), for stacks\n" +
        "      nothing will symbolicate. --no-network leaves the fetch shims\n" +
        "      out (-3.7 KB) for a bundle that declares no network — a widget\n" +
        "      entry that only reads storage and publishes timelines.\n" +
        "      --symbols keeps the bundle + map under <dir>/<releaseId>/<target>/,\n" +
        "      so a field stack that carries only a releaseId still finds its\n" +
        "      map weeks later (docs/debugging.md, 'Keep your symbols').\n\n" +
        "  react-watchos dev --entry <file> [--outfile dist/bundle.js]\n" +
        "                    [--host 127.0.0.1] [--port 8788]\n" +
        "      Live-reload server. DEBUG watch builds poll /bundle.js every 2s\n" +
        "      and hot-restart on change (override the polled URL with the\n" +
        "      ReactWatchDevServerURL Info.plist key).\n\n" +
        "  react-watchos inspector [--port 8099]\n" +
        "      Remote inspector UI — a DEBUG watch build (startInspector) posts\n" +
        "      the live tree + logs + errors here.\n",
    );
    process.exit(command ? 1 : 0);
}

function fail(error: unknown) {
  console.error(
    `[react-watchos] ${error instanceof Error ? error.message : error}`,
  );
  process.exit(1);
}
