#!/usr/bin/env bash
# Run the Swift suite on a watchOS simulator via `xcodebuild test`, so the
# #if os(watchOS) bridge code (BluetoothBridge, the SwiftUI host, the widget
# infra) is actually exercised. Plain `swift test` only covers the Foundation /
# Linux path — those bridges compile to an EMPTY module off-watchOS, so a bug in
# them slips past `swift test` entirely. Picks the first available watchOS sim;
# pass extra xcodebuild args through (e.g. -only-testing:...).
set -euo pipefail
cd "$(dirname "$0")/../swift"
ROOT="$(cd ../.. && pwd)"

# BundleSmokeTests boots the REAL production bundle (and its .qbc) through
# JSRuntime on the simulator — the only place the shipped artifact meets the
# shipped embedding on the watch architecture. Both are BUILD PRODUCTS, not
# fixtures, so make them when they're missing (the same build-if-missing shape
# tools/qjs-compile/run.sh uses); otherwise that test skips and this run looks
# green having proven less than it claims.
[ -f "$ROOT/js/dist/bundle.js" ] || (cd "$ROOT" && pnpm --filter react-watchos build)
[ -f "$ROOT/js/dist/bundle.qbc" ] || (cd "$ROOT" && pnpm --filter react-watchos build:bytecode)
# xcodebuild strips the TEST_RUNNER_ prefix and passes the rest into the test
# process: with the artifacts present, a skip now FAILS instead of passing
# quietly (the REQUIRE_QJS posture from the JS engine gate).
export TEST_RUNNER_REQUIRE_BUNDLE=1

SIM_ID=$(
  xcrun simctl list devices available --json | python3 -c '
import json, sys
d = json.load(sys.stdin)
ids = [
    dev["udid"]
    for runtime, devs in d["devices"].items()
    if "watchOS" in runtime
    for dev in devs
]
print(ids[0] if ids else "")
'
)

if [ -z "$SIM_ID" ]; then
  echo "No watchOS simulator available." >&2
  echo "Install one via Xcode > Settings > Components, then retry." >&2
  exit 1
fi

echo "Running xcodebuild test on watchOS simulator $SIM_ID"
exec xcodebuild test \
  -scheme ReactWatchHost-Package \
  -destination "platform=watchOS Simulator,id=$SIM_ID" \
  "$@"
