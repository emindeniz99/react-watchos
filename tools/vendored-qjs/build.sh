#!/bin/sh
# Builds the VENDORED quickjs-ng once, and lets every tool in this repo link
# against that one build. Nothing here downloads an engine: the sources are
# `js/swift/Sources/CQuickJS`, the same files SwiftPM compiles for watchOS, so
# the gates and the watch run the same engine.
#
# Two outputs, one stamp:
#   out/obj/*.o   the engine, compiled once — embed-smoke and qjs-compile link
#                 these instead of each recompiling ~100k lines of quickjs.c
#   out/qjs       a `qjs`-shaped CLI (main.c) for the vitest engine gate
#
# Usage:
#   build.sh            -> ensure built; print the qjs path
#   build.sh --objdir   -> ensure built; print the object directory
#
# Idempotent: a stamp over every input (engine sources, hosts, this script, the
# compiler identity) skips the ~30 s cold build when nothing moved. CI caches
# out/ on the same stamp, so a warm run is free and a vendor bump rebuilds
# exactly once. Diagnostics go to stderr so the printed path stays clean.
set -eu

cd "$(dirname "$0")"
VENDOR=../../js/swift/Sources/CQuickJS
OUT=out
OBJ="$OUT/obj"
BIN="$OUT/qjs"
STAMP="$OUT/.stamp"
CC_BIN="${CC:-cc}"
CFLAGS="-O2 -std=gnu11 -DNDEBUG"

# Hash everything that can change the output. The compiler identity is in there
# because a runner image that swaps cc must not reuse the old binary; the CPU is
# NOT, which is why no -march is passed — a cached artifact has to stay valid
# across the machines that share a cache key.
stamp() {
    {
        cat "$VENDOR"/*.c "$VENDOR"/include/*.h main.c build.sh
        "$CC_BIN" --version
    } | sha256sum | cut -d' ' -f1
}

WANT="$(stamp)"
if [ ! -x "$BIN" ] || [ ! -f "$STAMP" ] || [ "$(cat "$STAMP")" != "$WANT" ]; then
    mkdir -p "$OBJ"
    echo "vendored-qjs: building quickjs-ng from $VENDOR (~30 s, cached after this)" >&2
    for unit in quickjs libregexp libunicode dtoa; do
        # shellcheck disable=SC2086  # CFLAGS is a deliberate word list
        "$CC_BIN" $CFLAGS -I"$VENDOR/include" -c "$VENDOR/$unit.c" -o "$OBJ/$unit.o"
    done
    # shellcheck disable=SC2086
    "$CC_BIN" $CFLAGS -I"$VENDOR/include" -o "$BIN" main.c "$OBJ"/*.o -lm -lpthread
    printf '%s' "$WANT" >"$STAMP"
else
    echo "vendored-qjs: up to date" >&2
fi

case "${1:-}" in
--objdir) printf '%s\n' "$(pwd)/$OBJ" ;;
*) printf '%s\n' "$(pwd)/$BIN" ;;
esac
