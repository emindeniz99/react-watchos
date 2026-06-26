#!/usr/bin/env node
"use strict";

// react-native-watchos CLI.
//
// `react-native-watchos prebuild [...expo prebuild args]` runs `expo prebuild`
// and then the two authoritative post-steps in ONE command, so a consumer never
// hand-wires a `postprebuild` script (CX-012):
//   1. link the SwiftPM host products into the generated watch/widget targets,
//   2. merge each target's `infoPlist` into the Info.plist apple-targets wrote.
// Both run AFTER prebuild on purpose — @bacons/apple-targets injects the native
// targets through its own base mod, so they only exist once prebuild finishes
// (see plugin/link-swift-package.cjs for the full why). Both are idempotent.

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function run(file, args, cwd) {
  execFileSync(file, args, { stdio: "inherit", cwd });
}

/** The consumer's own Expo CLI, or null to fall back to `npx expo`. */
function resolveExpoCli(projectRoot) {
  try {
    return require.resolve("expo/bin/cli", { paths: [projectRoot] });
  } catch {
    return null;
  }
}

function prebuild(expoArgs) {
  const projectRoot = process.cwd();
  const cli = resolveExpoCli(projectRoot);
  if (cli) run(process.execPath, [cli, "prebuild", ...expoArgs], projectRoot);
  else run("npx", ["expo", "prebuild", ...expoArgs], projectRoot);

  // Authoritative wiring, now that every target is on disk. The scripts default
  // their project root to process.cwd(), which is `projectRoot` here.
  const plugin = path.join(__dirname, "..", "plugin");
  run(process.execPath, [path.join(plugin, "link-swift-package.cjs")], projectRoot);
  run(process.execPath, [path.join(plugin, "merge-target-infoplist.cjs")], projectRoot);
}

/** Generate the watch app's Swift entry point (the one bit of glue the config
 *  plugin can't generate), parameterized to match the plugin's resolved config
 *  read from app.json — so the App Group and name always agree (DX-3). */
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
  case "prebuild":
    prebuild(rest);
    break;
  case "scaffold":
    scaffold(rest);
    break;
  default:
    console.error(
      "react-native-watchos\n\n" +
        "Usage:\n" +
        "  react-native-watchos prebuild [expo prebuild args]\n" +
        "      Run `expo prebuild`, then link the SwiftPM host + merge the watch\n" +
        "      target Info.plists — the whole watch native setup in one command.\n" +
        "  react-native-watchos scaffold [--force]\n" +
        "      Generate targets/watch/WatchApp.swift (the @main watch App) from\n" +
        "      your app.json plugin config.\n",
    );
    process.exit(command ? 1 : 0);
}
