// The directive below is NOT redundant, whatever the lint rule says: its
// premise ("modules are automatically strict") holds for ESM, and every plugin
// file here is .cts, loaded as CommonJS both in-repo (Node type-stripping) and
// shipped (Expo requires the compiled dist-node/plugin.cjs). CommonJS is sloppy
// mode without it.
// biome-ignore lint/suspicious/noRedundantUseStrict: .cts is CommonJS — see above
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { loadConfigPlugins, loadXcode } = require("./peerDeps.cts");
const { wireLocalPackage } = require("./wireLocalPackage.cts");
const { deepMerge } = require("./mergeInfoPlist.cts");
const { readGeneratedTargets } = require("./readTargets.cts");
const { loadPlist } = require("./peerDeps.cts");

// In-prebuild native wiring (CX-012): link the SwiftPM host products into the
// generated watch/widget targets and merge each target's `infoPlist`, DURING
// `expo prebuild` — so a consumer just adds the plugin + runs `expo prebuild`,
// with no `postprebuild` step.
//
// Why a dedicated base mod and not `withXcodeProject`: @bacons/apple-targets
// injects the native targets through its OWN xcode base mod (`xcodeProjectBeta2`)
// and registers its target-injection mod + that base-mod *provider* atomically.
// Expo forbids adding a mod after a provider ("provider must be the last mod
// added"), so we can't hook `withXcodeProjectBeta` to run AFTER apple-targets.
// Instead we register our OWN custom base mod (the same `withGeneratedBaseMods`
// mechanism apple-targets uses) AFTER apple-targets — Expo runs base mods in
// registration order, so ours runs once apple-targets has written the targets
// to the .pbxproj. We then re-open it with the `xcode` package and reuse the
// SAME proven `wireLocalPackage` the post-prebuild script used.

const MOD_NAME = "reactWatchNativeWiring";

/** Merge each generated target's `infoPlist` into the Info.plist apple-targets
 *  wrote, preserving apple-targets' own keys (e.g. a widget's NSExtension).
 *  Idempotent. Returns the dirs it changed. */
function mergeTargetInfoPlists(projectRoot: string): string[] {
  const plist = loadPlist(projectRoot);
  const merged: string[] = [];
  for (const { dir, config } of readGeneratedTargets(projectRoot)) {
    const infoPlist = config.infoPlist;
    if (!infoPlist || Object.keys(infoPlist).length === 0) continue;
    const plistPath = path.join(projectRoot, "targets", dir, "Info.plist");
    if (!fs.existsSync(plistPath)) {
      // A target that DECLARES infoPlist keys but has no generated Info.plist
      // means apple-targets' write ordering changed under us. Silently
      // skipping would ship a build missing keys like
      // WKRunsIndependentlyOfCompanionApp or the deep-link URL scheme, which
      // only resurfaces as baffling runtime behavior — fail the prebuild
      // loudly instead (NF-31, same policy as the SwiftPM link).
      throw new Error(
        `[react-watchos] targets/${dir}/expo-target.config.js declares ` +
          "infoPlist keys, but apple-targets wrote no Info.plist at " +
          `${plistPath} — @bacons/apple-targets ordering may have changed; ` +
          "pin it to a tested version (see the plugin's peerDependencies).",
      );
    }
    const current = plist.parse(fs.readFileSync(plistPath, "utf8"));
    const before = plist.build(current);
    const after = plist.build(deepMerge(current, infoPlist));
    if (before !== after) {
      fs.writeFileSync(plistPath, after);
      merged.push(dir);
    }
  }
  return merged;
}

/**
 * Config plugin: link the SwiftPM products + merge the target Info.plists during
 * prebuild, after apple-targets created the targets. Must be called AFTER the
 * apple-targets plugin so our base mod is registered (and runs) after its
 * xcode base mod. A real wiring failure FAILS the prebuild loudly — a silently
 * unlinked target only resurfaces as a baffling "no such module ReactWatchHost"
 * at build time, which is far harder to diagnose. The genuinely benign case (no
 * watch/widget target to wire) doesn't throw — wireLocalPackage skips an absent
 * target — so it's reported as a warning, not swallowed.
 */
function withReactWatchNativeWiring(
  config: import("@expo/config-plugins").ExportedConfig,
  {
    packagePath,
    targetProducts,
  }: { packagePath: string; targetProducts: Record<string, string[]> },
) {
  const projectRoot = config._internal?.projectRoot ?? process.cwd();
  const cp = loadConfigPlugins(projectRoot);
  const xcode = loadXcode(projectRoot);

  // 1. The work, run when our base mod fires: re-open the freshly-written
  //    .pbxproj (targets present) + link, then merge the target Info.plists.
  config = cp.withMod(config, {
    platform: "ios",
    mod: MOD_NAME,
    action: (cfg: import("@expo/config-plugins").ExportedConfigWithProps) => {
      // No try/catch: a thrown error here means the .pbxproj edit genuinely
      // failed, and that MUST fail the prebuild rather than ship a project whose
      // watch target never links the host. The "no target yet" case is handled
      // inside wireLocalPackage (it skips an absent target), so it surfaces below
      // as an empty `linked`, not an exception.
      // modResults is our own base mod's payload (the XcodeProject the provider
      // below `read`s) — Expo types it as unknown for a custom mod name.
      const project =
        cfg.modResults as import("./wireLocalPackage.cts").XcodeProjectLike;
      const { linked } = wireLocalPackage(project, {
        packagePath,
        targetProducts,
      });
      if (linked.length) {
        console.log(
          `[react-watchos] linked SwiftPM products: ${linked.join(", ")}`,
        );
      } else {
        console.warn(
          "[react-watchos] no watch/widget target was linked — if you " +
            "expected one, check the apple-targets config and that " +
            "`react-watchos scaffold` has run.",
        );
      }
      const merged = mergeTargetInfoPlists(cfg.modRequest.projectRoot);
      if (merged.length) {
        console.log(
          `[react-watchos] merged infoPlist into ${merged.join(", ")}`,
        );
      }
      return cfg;
    },
  });

  // 2. The base-mod provider that reads/writes the .pbxproj with the `xcode`
  //    package. Added AFTER apple-targets' provider, so it runs after.
  config = cp.BaseMods.withGeneratedBaseMods(config, {
    platform: "ios",
    saveToInternal: true,
    skipEmptyMod: false,
    providers: {
      [MOD_NAME]: cp.BaseMods.provider({
        isIntrospective: false,
        // _internal is optional on the config TYPE, but prebuild always sets
        // projectRoot before mods run. Fail LOUDLY if that assumption breaks
        // (Rule 12) — a cwd fallback could silently edit the wrong pbxproj.
        getFilePath: ({
          _internal,
        }: {
          _internal?: { projectRoot?: string };
        }) => {
          const projectRoot = _internal?.projectRoot;
          if (typeof projectRoot !== "string") {
            throw new Error(
              "[react-watchos] config._internal.projectRoot is missing in " +
                "the native-wiring base mod — Expo prebuild should have set it.",
            );
          }
          return cp.IOSConfig.Paths.getPBXProjectPath(projectRoot);
        },
        read: (filePath: string) => {
          const project = xcode.project(filePath);
          project.parseSync();
          return project;
        },
        write: (
          filePath: string,
          { modResults }: { modResults: { writeSync(): string } },
        ) => {
          fs.writeFileSync(filePath, modResults.writeSync());
        },
      }),
    },
  });

  return config;
}

module.exports = { withReactWatchNativeWiring, mergeTargetInfoPlists };
