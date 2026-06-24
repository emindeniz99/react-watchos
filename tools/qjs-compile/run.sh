#!/bin/sh
# Compiles the production bundle to QuickJS bytecode (.qbc) with the SAME
# vendored quickjs-ng the watch app embeds (js/swift), so the bytecode version
# always matches the runtime that reads it. The .qbc is written to dist/ and
# copied next to bundle.js in both target asset dirs; the watch app + widget
# prefer it over the source (JSRuntime.evaluateBytecode), falling back to
# bundle.js if it is absent. A JS-only `build` deletes any stale .qbc, so the
# shipped bytecode is never out of sync with the source.
set -e
cd "$(dirname "$0")"
VENDOR=../../js/swift/Sources/CQuickJS
BUNDLE=../../js/dist/bundle.js
OUT=../../js/dist/bundle.qbc
[ -f "$BUNDLE" ] || (cd ../.. && pnpm --filter react-native-watchos build)
cc -O2 -std=gnu11 -DNDEBUG -I"$VENDOR/include" -o qjs-compile \
  qjs-compile.c "$VENDOR"/quickjs.c "$VENDOR"/libregexp.c \
  "$VENDOR"/libunicode.c "$VENDOR"/dtoa.c -lm -lpthread
./qjs-compile "$BUNDLE" "$OUT"
# Place beside bundle.js in both targets (mirrors js/scripts/config.mjs assets).
for d in watch widget; do
  dir="../../app/targets/$d/assets"
  mkdir -p "$dir"
  cp "$OUT" "$dir/bundle.qbc"
  echo "copied bytecode to app/targets/$d/assets/bundle.qbc"
done
