#!/bin/sh
# Compiles the vendored quickjs-ng sources together with the reference C
# host and runs the production bundle through it. Works on Linux/macOS;
# validates the exact embedding sequence JSRuntime.swift uses.
set -e
cd "$(dirname "$0")"
VENDOR=../../app/targets/watch/Vendor/quickjs
BUNDLE=../../js/dist/bundle.js
[ -f "$BUNDLE" ] || (cd ../../js && npm run build)
cc -O2 -std=gnu11 -DNDEBUG -I"$VENDOR" -o embed-host \
  embed-host.c "$VENDOR"/quickjs.c "$VENDOR"/libregexp.c \
  "$VENDOR"/libunicode.c "$VENDOR"/cutils.c "$VENDOR"/xsum.c -lm -lpthread
./embed-host "$BUNDLE"
