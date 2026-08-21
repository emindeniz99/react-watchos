#!/bin/sh
# EXPERIMENT (see README.md) — the stack-quality half of the comparison.
#
# Builds the shipped gate's throw fixture (js/test/fixtures/qbc-throw.entry.tsx)
# through the REAL esbuild preset, minified with an external source map, then
# throws it at both engines' shells and prints:
#
#   1. each engine's raw Error.stack, verbatim
#   2. each stack fed through the SHIPPED symbolicator
#      (js/scripts/symbolicate-core.ts, which `pnpm symbolicate` is a thin CLI
#      over) against that same map
#
# Both shells dump an uncaught exception's message and `.stack` on their own —
# tools/vendored-qjs/main.c's dump_error, and JSC's jsc.cpp printException — so
# no C is written for this. The fixture throws at module scope precisely so
# neither shell needs a __host bridge.
#
# THE TWO ENGINES DO NOT SPELL A FRAME THE SAME WAY, and that is a portability
# line item rather than cosmetics:
#
#   quickjs-ng    at qbcSymbolicationInnerThrow (bundle.js:1:123)
#   JSC           qbcSymbolicationInnerThrow@bundle.js:1:123
#
# `js/scripts/symbolicate-core.ts` matches only the first form
# (STACK_FRAME_RE = /^(\s*at\s+)(.*?)\s*\((.*):(\d+):(\d+)\)\s*$/, and its
# comment says the looser pattern was rejected on purpose). So this script
# rewrites JSC's frames into the parenthesised form before symbolicating. That
# rewrite is three lines of sed here; in a real port it is a second pattern in
# the shipped symbolicator and a matching change to JSRuntime.swift's stack
# parsing. ADAPTER.md §3 carries it.
set -eu

cd "$(dirname "$0")"
OUT=out
mkdir -p "$OUT"

QJS="$(sh ../vendored-qjs/build.sh)"
JSC="$(sh fetch-and-build.sh --jsc)"

node --experimental-strip-types build-stack-fixture.mts >/dev/null
BUNDLE="$OUT/throw-bundle.js"
MAP="$OUT/throw-bundle.js.map"

# Both shells exit non-zero on the uncaught throw — which is the EXPECTED
# outcome here, so `|| true` and then assert we actually got a stack.
"$QJS" "$BUNDLE" >"$OUT/stack-qjsng.raw" 2>&1 || true
"$JSC" "$BUNDLE" >"$OUT/stack-jsc.raw" 2>&1 || true

for f in "$OUT/stack-qjsng.raw" "$OUT/stack-jsc.raw"; do
    if ! grep -q "qbc-symbolication fixture" "$f"; then
        echo "stack-probe: $f does not contain the fixture's throw — the" >&2
        echo "             shell did not run it, so there is nothing to compare" >&2
        cat "$f" >&2
        exit 1
    fi
done

# quickjs-ng already emits `at name (file:line:col)`; pass it straight through.
cp "$OUT/stack-qjsng.raw" "$OUT/stack-qjsng.frames"
# JSC emits `name@file:line:col` (and bare `@file:line:col` for anonymous
# frames). Rewrite into the parenthesised form the shipped symbolicator parses.
sed -e 's|^\([^@ ][^@]*\)@\(.*\):\([0-9][0-9]*\):\([0-9][0-9]*\)$|    at \1 (\2:\3:\4)|' \
    -e 's|^@\(.*\):\([0-9][0-9]*\):\([0-9][0-9]*\)$|    at <anonymous> (\1:\2:\3)|' \
    "$OUT/stack-jsc.raw" >"$OUT/stack-jsc.frames"

symbolicate() {
    (cd ../.. && node --experimental-strip-types js/scripts/symbolicate.ts \
        "tools/jsconly-smoke/$MAP") <"$1"
}

echo
echo '=== raw Error.stack — quickjs-ng ==='
cat "$OUT/stack-qjsng.raw"
echo
echo '=== raw Error.stack — jsc (jitless) ==='
cat "$OUT/stack-jsc.raw"
echo
echo '=== symbolicated — quickjs-ng ==='
symbolicate "$OUT/stack-qjsng.frames"
echo
echo '=== symbolicated — jsc (jitless), after the @ -> at() rewrite ==='
symbolicate "$OUT/stack-jsc.frames"
