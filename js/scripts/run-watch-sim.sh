#!/usr/bin/env bash
# Build the DEMO watch app + embedded widget, install and launch on a watchOS
# simulator — the canonical "run the demo on the sim" path.
#
# ⚠️  WHY THIS SCRIPT EXISTS — the App-Group signing trap (we kept re-hitting it):
#     The demo's shared state (Hydration + Shopping counters, and the widget /
#     complication that reads them) is backed by an **App Group**
#     (group.com.emindeniz99.reactwatch) via UserDefaults(suiteName:). App
#     Groups are gated by the `com.apple.security.application-groups`
#     ENTITLEMENT. Two SEPARATE things strip it — both bite on the simulator:
#
#     1. `CODE_SIGNING_ALLOWED=NO` (a "just build it" convenience) drops ALL
#        entitlements. So we build ad-hoc signed (CODE_SIGN_IDENTITY="-").
#
#     2. Even WITH ad-hoc signing, `xcodebuild` for the **Simulator** writes
#        "simulated entitlements" that keep only `get-task-allow` and DROP App
#        Groups (on device those need a provisioning profile; the sim build has
#        none). So the built .app ships an EMPTY <dict/> entitlement even though
#        CODE_SIGN_ENTITLEMENTS resolves to generated.entitlements. This is the
#        subtle one — the build looks correct, the setting is correct, yet the
#        signature has no group, so counterAdd/counterValue write to nowhere and
#        every shared-state screen reads 0. Looks like a renderer/logic bug; it
#        is an entitlement bug.
#
#     Fix for (2): after the build, **manually re-sign** the .app AND the
#     embedded widget .appex with their real generated.entitlements (codesign
#     --entitlements bypasses the simulated-entitlements filtering; the sim
#     honors the embedded group without a profile). This script does both steps
#     and then asserts the group is actually present. NEVER add
#     CODE_SIGNING_ALLOWED=NO here.
#
# Usage:  pnpm --filter react-watchos run:watch [SIM_UDID]
#   SIM_UDID optional; defaults to the first booted watchOS sim, else the first
#   available one (which it boots).
set -euo pipefail
cd "$(dirname "$0")/.."          # js/
ROOT=$(cd .. && pwd)             # project root
WORKSPACE="$ROOT/app/ios/ReactWatchDemo.xcworkspace"
SCHEME="React Watch"
BUNDLE_ID="com.emindeniz99.reactwatch.watch"

# 0) Node-floor guard + .xcode.env.local re-pin (2026-08-06). Two traps, same
#    root: the typed .cts tooling needs Node's native type stripping (>=22.18).
#    (a) This script itself must run on such a node — verify, don't assume.
#    (b) `expo prebuild` HARDCODES the node it saw into app/ios/.xcode.env.local,
#        and Xcode script phases use THAT binary, ignoring this shell's PATH —
#        a stale pin (e.g. nvm 22.16) makes the EXConstants "Generate
#        app.config" phase die parsing plugin/index.cts ("Unexpected
#        identifier 'ReactWatchOptions'"). Re-pin it to the verified node.
# shellcheck disable=SC2016 # single quotes are REQUIRED: the `$(mise where node)`
# below is advice text inside a JS template literal, printed for the user to copy.
# Double-quoting would make the shell run mise here and bake the result into the
# message — the opposite of what it tells the reader to do.
node -e 'const [maj,min]=process.versions.node.split(".").map(Number);
if (maj<22 || (maj===22 && min<18)) {
  console.error(`node ${process.version} is below the >=22.18 type-stripping floor `
    + `(.mise.toml pins 24). Run via mise, e.g. PATH="$(mise where node)/bin:$PATH" pnpm run:watch`);
  process.exit(1);
}'
if [ -d "$ROOT/app/ios" ]; then
  printf 'export NODE_BINARY=%s\n' "$(command -v node)" > "$ROOT/app/ios/.xcode.env.local"
  echo "==> Pinned app/ios/.xcode.env.local to $(command -v node) ($(node --version))"
fi

# 1) Fresh JS bundle → copied into app/targets/watch/assets/bundle.js by build.ts.
echo "==> Building JS bundle"
node --experimental-strip-types scripts/build.ts

# 2) Pick a watchOS simulator: prefer an already-booted one, else first available.
SIM_ID=${1:-$(
  xcrun simctl list devices --json | python3 -c '
import json, sys
d = json.load(sys.stdin)
booted, available = "", ""
for runtime, devs in d["devices"].items():
    if "watchOS" not in runtime:
        continue
    for dev in devs:
        if not dev.get("isAvailable", False):
            continue
        available = available or dev["udid"]
        if dev.get("state") == "Booted":
            booted = booted or dev["udid"]
print(booted or available)
')}
if [ -z "$SIM_ID" ]; then
  echo "No watchOS simulator available. Add one via Xcode > Settings > Components." >&2
  exit 1
fi
echo "==> Simulator: $SIM_ID"
xcrun simctl boot "$SIM_ID" 2>/dev/null || true   # no-op if already booted

# 3) Build the watch app + embedded widget, ad-hoc signed (carries the App Group).
echo "==> xcodebuild (ad-hoc signed)"
xcodebuild build \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration Debug \
  -destination "platform=watchOS Simulator,id=$SIM_ID" \
  CODE_SIGN_IDENTITY="-" \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGNING_ALLOWED=YES \
  AD_HOC_CODE_SIGNING_ALLOWED=YES \
  -quiet

# 4) Locate the built .app.
APP=$(xcodebuild -workspace "$WORKSPACE" -scheme "$SCHEME" -configuration Debug \
  -destination "platform=watchOS Simulator,id=$SIM_ID" -showBuildSettings 2>/dev/null \
  | awk -F' = ' '/ CODESIGNING_FOLDER_PATH =/ {print $2; exit}')
if [ -z "${APP:-}" ] || [ ! -d "$APP" ]; then
  echo "Could not locate the built .app for scheme '$SCHEME'." >&2
  exit 1
fi

# 5) Re-sign so the App Group survives on the sim (see the header — xcodebuild's
# simulated entitlements drop it). Two sim-specific tweaks vs generated.entitlements:
#   - ADD com.apple.security.get-task-allow — a Debug build needs it to launch.
#   - REMOVE com.apple.developer.healthkit — a restricted entitlement that needs
#     a provisioning profile; ad-hoc self-signing it makes SpringBoard REFUSE the
#     launch (IOSSHLMainWorkspace denied). The demo's shared state only needs the
#     App Group, so dropping healthkit for the sim run is safe.
# Sign the nested widget .appex FIRST, then the outer app.
#
# Where generated.entitlements lives: @bacons/apple-targets 5 stopped writing it
# next to the target source (targets/<dir>/) and now writes it under the prebuilt
# ios/ tree, keyed by PRODUCT name — ios/.targets/<productName>/. That directory
# is wiped and rewritten by every `expo prebuild`, so run prebuild before this.
ENT_DIR="$ROOT/app/ios/.targets"
TMPENT=$(mktemp -d)
sim_entitlements() {  # $1 = source generated.entitlements, $2 = out path
  cp "$1" "$2"
  /usr/libexec/PlistBuddy -c "Delete :com.apple.developer.healthkit" "$2" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c "Add :com.apple.security.get-task-allow bool true" "$2" 2>/dev/null \
    || /usr/libexec/PlistBuddy -c "Set :com.apple.security.get-task-allow true" "$2"
}
echo "==> Re-signing with sim-safe entitlements (App Group, +get-task-allow, -healthkit)"
# First .appex in PlugIns/, via a glob rather than `ls` — a build directory
# path can contain spaces (Xcode DerivedData under "~/Library/Application
# Support/…" routinely does), and parsing `ls` output splits on them.
APPEX=""
for candidate in "$APP/PlugIns/"*.appex; do
  # No `nullglob` here (this script is portable-ish sh style): an unmatched
  # glob stays the literal pattern, so check the path really exists.
  [ -e "$candidate" ] || break
  APPEX=$candidate
  break
done
if [ -n "${APPEX:-}" ]; then
  sim_entitlements "$ENT_DIR/ReactWatchWidgets/generated.entitlements" "$TMPENT/widget.ent"
  codesign --force --sign - --entitlements "$TMPENT/widget.ent" "$APPEX"
fi
sim_entitlements "$ENT_DIR/ReactWatch/generated.entitlements" "$TMPENT/watch.ent"
codesign --force --sign - --entitlements "$TMPENT/watch.ent" "$APP"

# Assert the group actually made it in — a silent miss here is the whole bug.
if ! codesign -d --entitlements :- "$APP" 2>/dev/null | grep -q "application-groups"; then
  echo "ERROR: re-sign did not embed application-groups — App-Group state will read 0." >&2
  exit 1
fi

# 6) Install + launch.
echo "==> Installing $APP"
xcrun simctl install "$SIM_ID" "$APP"

echo "==> Launching $BUNDLE_ID"
xcrun simctl launch "$SIM_ID" "$BUNDLE_ID"
echo "Done. Boot log: xcrun simctl spawn $SIM_ID log stream --predicate 'subsystem == \"com.reactwatchos.runtime\"'"
