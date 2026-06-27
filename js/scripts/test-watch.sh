#!/usr/bin/env bash
# Run the Swift suite on a watchOS simulator via `xcodebuild test`, so the
# #if os(watchOS) bridge code (BluetoothBridge, the SwiftUI host, the widget
# infra) is actually exercised. Plain `swift test` only covers the Foundation /
# Linux path — those bridges compile to an EMPTY module off-watchOS, so a bug in
# them slips past `swift test` entirely. Picks the first available watchOS sim;
# pass extra xcodebuild args through (e.g. -only-testing:...).
set -euo pipefail
cd "$(dirname "$0")/../swift"

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
