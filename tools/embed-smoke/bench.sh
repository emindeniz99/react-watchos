#!/bin/sh
# Tree-commit benchmark (NF-20): runs bench-epilogue.js against the real
# demo bundle inside the VENDORED quickjs-ng via embed-host, producing
# interpreter-engine numbers for the tree-diff/patch-protocol decision
# (the vitest bench runs under V8 and must not be used for that call).
# Reuses an already-built embed-host when present; run.sh always rebuilds.
set -e
cd "$(dirname "$0")"
VENDOR=../../js/swift/Sources/CQuickJS
BUNDLE=../../js/dist/bundle.js
[ -f "$BUNDLE" ] || (cd ../.. && pnpm --filter react-native-watchos build)
[ -x embed-host ] || cc -O2 -std=gnu11 -DNDEBUG -I"$VENDOR/include" -o embed-host \
  embed-host.c "$VENDOR"/quickjs.c "$VENDOR"/libregexp.c \
  "$VENDOR"/libunicode.c "$VENDOR"/dtoa.c -lm -lpthread
./embed-host "$BUNDLE" bench-epilogue.js
