#!/bin/sh
# Compiles each production bundle to QuickJS bytecode (.qbc) with the SAME
# vendored quickjs-ng the watch app embeds (js/swift), so the bytecode version
# always matches the runtime that reads it. ARCH-03 ships two bundles — the app
# (dist/bundle.js -> watch target) and the widget (dist/widget.bundle.js ->
# widget target); each .qbc is copied next to its target's bundle.js as
# bundle.qbc. The watch app + widget prefer the .qbc over the source
# (JSRuntime.evaluateBytecode), falling back to bundle.js if it is absent. A
# JS-only `build` deletes any stale .qbc, so shipped bytecode is never out of
# sync with the source.
set -e
cd "$(dirname "$0")"
VENDOR=../../js/swift/Sources/CQuickJS
# Ensure both bundles exist (build emits app + widget together).
[ -f ../../js/dist/bundle.js ] || (cd ../.. && pnpm --filter react-native-watchos build)
cc -O2 -std=gnu11 -DNDEBUG -I"$VENDOR/include" -o qjs-compile \
  qjs-compile.c "$VENDOR"/quickjs.c "$VENDOR"/libregexp.c \
  "$VENDOR"/libunicode.c "$VENDOR"/dtoa.c -lm -lpthread
# compile <source.js> <target-dir>: emit <source>.qbc and drop it as the
# target's bundle.qbc.
compile() {
  out="${1%.js}.qbc"
  ./qjs-compile "$1" "$out"
  dir="../../app/targets/$2/assets"
  mkdir -p "$dir"
  cp "$out" "$dir/bundle.qbc"
  echo "compiled $1 -> $dir/bundle.qbc"
}
compile ../../js/dist/bundle.js watch
compile ../../js/dist/widget.bundle.js widget
