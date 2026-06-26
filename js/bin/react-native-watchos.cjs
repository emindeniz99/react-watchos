#!/usr/bin/env node
"use strict";

// react-native-watchos CLI.
//
// `react-native-watchos scaffold [--force]` generates the @main Swift glue the
// config plugin can't generate: targets/watch/WatchApp.swift (the watch app) and,
// when the widget target is enabled, targets/widget/ReactWidgets.swift (the
// @main WidgetBundle). It reads app.json and reuses the plugin's resolveOptions,
// so the struct names + App Group match your plugin config.
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

  const { watchAppSwift, widgetBundleSwift } = require("../plugin/scaffold.cjs");

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
      'edit to add a widget per registered `kind`',
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
    console.error(`[scaffold] ${relPath} already exists (pass --force to overwrite)`);
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
  default:
    console.error(
      "react-native-watchos\n\n" +
        "Usage:\n" +
        "  react-native-watchos scaffold [--force]\n" +
        "      Generate the @main Swift glue from your app.json plugin config:\n" +
        "      targets/watch/WatchApp.swift, plus targets/widget/ReactWidgets.swift\n" +
        "      when the widget target is enabled. Then run `expo prebuild` — the\n" +
        "      plugin links the SwiftPM packages + merges the Info.plists.\n",
    );
    process.exit(command ? 1 : 0);
}
