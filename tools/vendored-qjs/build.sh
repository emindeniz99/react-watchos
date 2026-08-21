#!/bin/sh
# Builds the VENDORED quickjs-ng once, and lets every tool in this repo link
# against that one build. Nothing here downloads an engine: the sources are
# `js/swift/Sources/CQuickJS`, the same files SwiftPM compiles for watchOS, so
# the gates and the watch run the same engine.
#
# Two outputs, one stamp:
#   <cache>/obj/*.o   the engine, compiled once — embed-smoke and qjs-compile
#                     link these instead of each recompiling ~100k lines of
#                     quickjs.c
#   <cache>/qjs       a `qjs`-shaped CLI (main.c) for the vitest engine gate
#
# Usage:
#   build.sh            -> ensure built; print the qjs path
#   build.sh --objdir   -> ensure built; print the object directory
#
# WHERE it builds: a per-user cache directory outside the repo
# (${XDG_CACHE_HOME:-~/.cache}/react-watchos/vendored-qjs, override with
# QJS_BUILD_DIR). Out of the repo because build output is not source and a
# worktree should stay clean; per-user rather than /tmp because /tmp is swept
# and macOS gives each login session its own TMPDIR — a cache that evaporates
# is a 30 s rebuild. Shared across checkouts, so a second clone or a git
# worktree costs nothing.
#
# Idempotent: a stamp over every input skips the ~30 s cold build when nothing
# moved. CI caches the same directory on the same inputs, so a warm run is free
# and a vendor bump rebuilds exactly once. Diagnostics go to stderr so the
# printed path stays clean.
set -eu

cd "$(dirname "$0")"
VENDOR=../../js/swift/Sources/CQuickJS
CC_BIN="${CC:-cc}"
CFLAGS="-O2 -std=gnu11 -DNDEBUG"

if [ -n "${QJS_BUILD_DIR:-}" ]; then
    OUT="$QJS_BUILD_DIR"
else
    OUT="${XDG_CACHE_HOME:-${HOME:-${TMPDIR:-/tmp}}/.cache}/react-watchos/vendored-qjs"
fi
# Absolute, always: the paths printed below are consumed from other working
# directories (the vitest gate, tools/embed-smoke, tools/qjs-compile), so a
# relative QJS_BUILD_DIR must not leak out as a relative path.
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
OBJ="$OUT/obj"
BIN="$OUT/qjs"
STAMP="$OUT/.stamp"

# Hash everything that can change the output, INCLUDING the machine: `uname -sm`
# is in the stamp because these are object files and an executable — machine
# code for one OS and one architecture. Reusing an x86_64 build on arm64 (a
# repo mounted into a linux/amd64 container, an arm64 host running both) is not
# a stale build, it is an unrunnable one, and without this the stamp would
# happily call it up to date. The compiler identity is in there for the same
# reason: an image that swaps cc must not reuse the old binary.
#
# The CPU MODEL is deliberately NOT in the stamp — and that is why no -march is
# passed. -march=native would bake in whatever instructions the building
# machine happens to have, so a cache filled on an AVX-512 runner would crash
# with SIGILL on a runner without it. Architecture (arm64 vs x86_64) decides
# whether the artifact is valid at all; the CPU within an architecture must not,
# so the build stays baseline and portable across the machines sharing a key.
stamp() {
    {
        cat "$VENDOR"/*.c "$VENDOR"/include/*.h main.c build.sh
        uname -sm
        "$CC_BIN" --version
    } | sha256sum | cut -d' ' -f1
}

WANT="$(stamp)"
if [ ! -x "$BIN" ] || [ ! -f "$STAMP" ] || [ "$(cat "$STAMP")" != "$WANT" ]; then
    mkdir -p "$OBJ"
    # Drop the stamp BEFORE touching the objects: they are overwritten in
    # place, so a build killed halfway (Ctrl-C, an OOM, a cancelled CI job)
    # would otherwise leave the previous stamp next to half-written objects and
    # the next run would call that up to date. Absent stamp = rebuild.
    rm -f "$STAMP"
    echo "vendored-qjs: building quickjs-ng from $VENDOR into $OUT (~30 s, cached after this)" >&2
    for unit in quickjs libregexp libunicode dtoa; do
        # shellcheck disable=SC2086  # CFLAGS is a deliberate word list
        "$CC_BIN" $CFLAGS -I"$VENDOR/include" -c "$VENDOR/$unit.c" -o "$OBJ/$unit.o"
    done
    # shellcheck disable=SC2086
    "$CC_BIN" $CFLAGS -I"$VENDOR/include" -o "$BIN" main.c "$OBJ"/*.o -lm -lpthread
    printf '%s' "$WANT" >"$STAMP"
else
    echo "vendored-qjs: up to date ($OUT)" >&2
fi

case "${1:-}" in
--objdir) printf '%s\n' "$OBJ" ;;
*) printf '%s\n' "$BIN" ;;
esac
