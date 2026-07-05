#!/bin/sh
# Compiles the vendored quickjs-ng sources together with the reference C
# host and runs the production bundle through it. Works on Linux/macOS;
# validates the exact embedding sequence JSRuntime.swift uses.
set -e
cd "$(dirname "$0")"
# quickjs-ng now lives in the SwiftPM package's CQuickJS target (shipped
# inside the npm package at js/swift).
VENDOR=../../js/swift/Sources/CQuickJS
BUNDLE=../../js/dist/bundle.js
[ -f "$BUNDLE" ] || (cd ../.. && pnpm --filter react-watchos build)
cc -O2 -std=gnu11 -DNDEBUG -I"$VENDOR/include" -o embed-host \
  embed-host.c "$VENDOR"/quickjs.c "$VENDOR"/libregexp.c \
  "$VENDOR"/libunicode.c "$VENDOR"/dtoa.c -lm -lpthread
# The [mem] diagnostic goes to stderr (the JSON result owns stdout) —
# capture both so the gate can read it.
OUTPUT=$(./embed-host "$BUNDLE" 2>&1)
printf '%s\n' "$OUTPUT"

# Memory budget gate (review §6.13): the demo bundle's QuickJS heap after a
# full mount + one interaction must stay under budget, or a memory regression
# lands silently and only resurfaces as a jetsam on a real watch. Current
# baseline ~2.2 MB; budget 6 MB (the widget runs the same engine under a
# 16 MB cap). Gate on the engine heap (printed identically on Linux/macOS),
# not peak RSS (ru_maxrss units differ per platform). A missing [mem] line
# fails too — a gate that can silently skip is not a gate.
HEAP_BUDGET_MB=6
HEAP_MB=$(printf '%s\n' "$OUTPUT" \
  | sed -n 's/^\[mem\] quickjs heap: \([0-9.]*\) MB.*/\1/p')
if [ -z "$HEAP_MB" ]; then
  echo "embed-smoke: no [mem] heap line in the host output — gate cannot run" >&2
  exit 1
fi
if ! awk -v heap="$HEAP_MB" -v budget="$HEAP_BUDGET_MB" \
  'BEGIN { exit !(heap <= budget) }'; then
  echo "embed-smoke: quickjs heap ${HEAP_MB} MB exceeds the ${HEAP_BUDGET_MB} MB budget" >&2
  exit 1
fi
echo "embed-smoke: quickjs heap ${HEAP_MB} MB within budget ${HEAP_BUDGET_MB} MB"

# Boot parse-time tripwire: wall-clock to parse+eval the bundle and commit the
# first tree (docs/budgets-and-limits.md §JS bundle). This is the axis a
# bundle-size-budget raise trades against — the heap gate above cannot see it.
# UNLIKE the heap number this is dev-hardware-relative (wall-clock, not a
# portable engine metric), so the budget is deliberately loose: ~6x the current
# baseline (~40 ms here) — enough headroom for a slow/loaded CI runner while
# still tripping on a gross regression (e.g. a dependency that triples
# cold-start). Retune (don't tighten) when you consciously raise the size
# budget. A missing [boot] line fails too — a gate that can silently skip is
# not a gate.
BOOT_BUDGET_MS=250
BOOT_MS=$(printf '%s\n' "$OUTPUT" \
  | sed -n 's/^\[boot\] parse+eval+first-commit: \([0-9.]*\) ms.*/\1/p')
if [ -z "$BOOT_MS" ]; then
  echo "embed-smoke: no [boot] line in the host output — gate cannot run" >&2
  exit 1
fi
if ! awk -v boot="$BOOT_MS" -v budget="$BOOT_BUDGET_MS" \
  'BEGIN { exit !(boot <= budget) }'; then
  echo "embed-smoke: boot ${BOOT_MS} ms exceeds the ${BOOT_BUDGET_MS} ms tripwire (dev-relative)" >&2
  exit 1
fi
echo "embed-smoke: boot ${BOOT_MS} ms within tripwire ${BOOT_BUDGET_MS} ms (dev-relative)"
