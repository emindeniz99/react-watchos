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

/** Parse the shared build/dev flags. */
function buildFlags(args) {
  const { values } = parseArgs({
    args,
    options: {
      entry: { type: "string" },
      outfile: { type: "string", default: path.join("dist", "bundle.js") },
      asset: { type: "string" },
      minify: { type: "boolean", default: false },
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
  return values;
}

/** One-shot bundle build via the published preset (+ OTA manifest stamp). */
async function build(args) {
  const f = buildFlags(args);
  const { buildBundles } = await import("../esbuild/preset.mjs");
  const results = await buildBundles(
    [
      {
        entry: f.entry,
        outfile: f.outfile,
        name: "app",
        manifest: { version: Number(f.version) },
      },
    ],
    { minify: f.minify },
  );
  for (const r of results) {
    console.log(`[build] ${r.outfile} (${r.sizeKB} KB)`);
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
async function dev(args) {
  const f = buildFlags(args);
  let context;
  try {
    ({ context } = await import("esbuild"));
  } catch (err) {
    if (err?.code === "ERR_MODULE_NOT_FOUND") {
      console.error(
        "[react-watchos] dev needs esbuild installed (npm i -D esbuild).",
      );
      process.exit(1);
    }
    throw err;
  }
  const { watchBuildOptions } = await import("../esbuild/preset.mjs");
  const ctx = await context(
    watchBuildOptions({ entry: f.entry, outfile: f.outfile }),
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
async function inspector(args) {
  const { values } = parseArgs({
    args,
    options: { port: { type: "string" } },
  });
  if (values.port) process.env.INSPECTOR_PORT = values.port;
  await import("./inspector-server.mjs"); // listens on import
}

/** Generate the watch app's Swift entry point, parameterized to match the
 *  plugin's resolved app.json config so the App Group + name always agree. */
function scaffold(args) {
  const projectRoot = process.cwd();
  const force = args.includes("--force");
  const appJsonPath = path.join(projectRoot, "app.json");
  if (!fs.existsSync(appJsonPath)) {
    console.error(`[scaffold] no app.json in ${projectRoot}`);
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(appJsonPath, "utf8")).expo ?? {};
  const plugin = require("../plugin");
  const entry = (config.plugins ?? []).find(
    (p) => (Array.isArray(p) ? p[0] : p) === "react-watchos",
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
  } = require("../plugin/scaffold.cjs");

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

/** Write one scaffolded file, refusing to clobber an edited one without --force. */
function writeGlue(projectRoot, relPath, contents, force, note) {
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
        "                      [--asset <copy-to>] [--minify] [--version <n>]\n" +
        "      One-shot QuickJS-correct bundle build (published esbuild preset)\n" +
        "      + OTA manifest stamp next to the outfile.\n\n" +
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

function fail(error) {
  console.error(`[react-watchos] ${error?.message ?? error}`);
  process.exit(1);
}
