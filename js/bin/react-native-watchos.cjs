#!/usr/bin/env node
"use strict";

// react-native-watchos CLI.
//
// `react-native-watchos scaffold [--force]` generates targets/watch/WatchApp.swift
// — the watch app's @main Swift entry, the one bit of glue the config plugin
// can't generate. It reads app.json and reuses the plugin's resolveOptions, so
// the struct name + App Group match your plugin config.
//
// There is intentionally no `prebuild` command: the config plugin links the
// SwiftPM host + merges the target Info.plists during `expo prebuild` itself
// (see plugin/withNativeWiring.js), so `expo prebuild` is all you run.

const fs = require("node:fs");
const path = require("node:path");

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
    (p) => (Array.isArray(p) ? p[0] : p) === "react-native-watchos",
  );
  if (!entry) {
    console.error(
      "[scaffold] add the `react-native-watchos` plugin to app.json first.",
    );
    process.exit(1);
  }
  const options = Array.isArray(entry) ? (entry[1] ?? {}) : {};
  const opts = plugin.resolveOptions(config, options);

  const { watchAppSwift } = require("../plugin/scaffold.cjs");
  const dir = path.join(projectRoot, "targets", plugin.WATCH_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "WatchApp.swift");
  const rel = path.relative(projectRoot, file);
  if (fs.existsSync(file) && !force) {
    console.error(`[scaffold] ${rel} already exists (pass --force to overwrite)`);
    process.exit(1);
  }
  fs.writeFileSync(
    file,
    watchAppSwift({ name: opts.name, appGroupId: opts.appGroup }),
  );
  console.log(`[scaffold] wrote ${rel} (App Group ${opts.appGroup})`);
  if (opts.widget) {
    console.log(
      "[scaffold] note: widget glue is app-specific — copy the WidgetBundle / " +
        "providers / intents from the demo (app/targets/widget) and adapt.",
    );
  }
}

const [command, ...rest] = process.argv.slice(2);
switch (command) {
  case "scaffold":
    scaffold(rest);
    break;
  default:
    console.error(
      "react-native-watchos\n\n" +
        "Usage:\n" +
        "  react-native-watchos scaffold [--force]\n" +
        "      Generate targets/watch/WatchApp.swift (the @main watch App) from\n" +
        "      your app.json plugin config. Then run `expo prebuild` — the plugin\n" +
        "      links the SwiftPM host + merges the Info.plist automatically.\n",
    );
    process.exit(command ? 1 : 0);
}
