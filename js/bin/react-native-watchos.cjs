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

const [command, ...rest] = process.argv.slice(2);
switch (command) {
  case "prebuild":
    prebuild(rest);
    break;
  default:
    console.error(
      "react-native-watchos\n\n" +
        "Usage:\n" +
        "  react-native-watchos prebuild [expo prebuild args]\n" +
        "      Run `expo prebuild`, then link the SwiftPM host + merge the watch\n" +
        "      target Info.plists — the whole watch native setup in one command.\n",
    );
    process.exit(command ? 1 : 0);
}
