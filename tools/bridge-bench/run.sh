#!/bin/sh
# Microbenchmark for the native->JS bridge rewrite, on the real vendored
# quickjs-ng. Compares the OLD path (build a JS source string + JS_Eval, which
# lexes/parses/compiles every call, + JSON.parse) against the NEW path (build
# QuickJS values directly + JS_Call on a cached function) — the same change
# JSRuntime.swift made. Works on Linux/macOS; reports ns/call + the speedup.
set -e
cd "$(dirname "$0")"
VENDOR=../../swift/Sources/CQuickJS
cc -O2 -std=gnu11 -DNDEBUG -I"$VENDOR/include" -o bench \
  bench.c "$VENDOR"/quickjs.c "$VENDOR"/libregexp.c \
  "$VENDOR"/libunicode.c "$VENDOR"/cutils.c "$VENDOR"/xsum.c -lm -lpthread
./bench
