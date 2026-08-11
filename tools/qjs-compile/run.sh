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
[ -f ../../js/dist/bundle.js ] || (cd ../.. && pnpm --filter react-watchos build)
cc -O2 -std=gnu11 -DNDEBUG -I"$VENDOR/include" -o qjs-compile \
  qjs-compile.c "$VENDOR"/quickjs.c "$VENDOR"/libregexp.c \
  "$VENDOR"/libunicode.c "$VENDOR"/dtoa.c -lm -lpthread
# compile <source.js> <target-dir>: emit <source>.qbc + <source>.hash (OP-1:
# ContentHash.of the source, so the runtime can refuse a stale/hand-swapped
# pairing — see ReactWatchHost.loadShipped / WidgetIntentRuntime.loadShippedBundle)
# and drop both next to the target's bundle.js as bundle.qbc / bundle.hash.
compile() {
  out="${1%.js}.qbc"
  hashout="${1%.js}.hash"
  ./qjs-compile "$1" "$out" "$hashout"
  dir="../../app/targets/$2/assets"
  mkdir -p "$dir"
  cp "$out" "$dir/bundle.qbc"
  cp "$hashout" "$dir/bundle.hash"
  echo "compiled $1 -> $dir/bundle.qbc (+ bundle.hash)"
}
compile ../../js/dist/bundle.js watch
compile ../../js/dist/widget.bundle.js widget
