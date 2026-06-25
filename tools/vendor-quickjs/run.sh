#!/bin/sh
# Re-vendors quickjs-ng into js/swift/Sources/CQuickJS for a new upstream
# release. Maintenance helper — run by hand when bumping the engine, not part
# of the build.
#
# Usage:  ./run.sh v0.16.0
#
# What it does, and only this:
#   1. downloads the upstream source tarball for the given tag
#   2. overwrites the four compiled sources — the upstream `qjs_sources` set
#      (quickjs.c libregexp.c libunicode.c dtoa.c) — at the CQuickJS root
#   3. refreshes every header we already vendor under include/, by name, so the
#      curated set is preserved and nothing new (quickjs-libc.h, xsum.*, …)
#      sneaks in
#   4. refreshes the upstream LICENSE
#   5. bumps the version line + source URL in VERSION.md
#
# It never overwrites quickjs-swift-shim.h (that header is ours) and never adds
# quickjs-libc / cutils.c — the watch app's only I/O is the JS `__host` bridge
# installed by JSRuntime.swift (see VERSION.md). If upstream changed which files
# compile, the qjs_sources list above and the prose in VERSION.md need a manual
# look; tools/embed-smoke/run.sh is the proof it still embeds.
set -e
cd "$(dirname "$0")"

TAG="$1"
[ -n "$TAG" ] || { echo "usage: $0 <tag>   e.g. $0 v0.16.0" >&2; exit 1; }

VENDOR=../../js/swift/Sources/CQuickJS
URL="https://github.com/quickjs-ng/quickjs/archive/refs/tags/$TAG.tar.gz"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "downloading $URL"
curl -fsSL "$URL" | tar -xz -C "$TMP"
SRC=$(echo "$TMP"/quickjs-*)
[ -d "$SRC" ] || { echo "extracted source dir not found in $TMP" >&2; exit 1; }

echo "copying compiled sources (qjs_sources)"
for c in quickjs.c libregexp.c libunicode.c dtoa.c; do
  cp "$SRC/$c" "$VENDOR/$c"
done

echo "refreshing vendored headers (curated set preserved)"
for h in "$VENDOR"/include/*.h; do
  name=$(basename "$h")
  if [ "$name" = "quickjs-swift-shim.h" ]; then
    continue   # ours, not upstream
  fi
  if [ -f "$SRC/$name" ]; then
    cp "$SRC/$name" "$VENDOR/include/$name"
  else
    echo "  warning: $name no longer exists upstream — review by hand" >&2
  fi
done

cp "$SRC/LICENSE" "$VENDOR/LICENSE"

echo "bumping VERSION.md to $TAG"
sed -i.bak \
  -e "1s|.*|# Vendored: quickjs-ng $TAG|" \
  -e "s|archive/refs/tags/v[0-9.]*\.tar\.gz|archive/refs/tags/$TAG.tar.gz|" \
  "$VENDOR/VERSION.md"
rm -f "$VENDOR/VERSION.md.bak"

cat <<EOF

Done — vendored quickjs-ng $TAG.
Next:
  1. Review the prose in $VENDOR/VERSION.md (the qjs_sources note may need an
     update if upstream changed which files compile).
  2. Bump the version in js/swift/README.md.
  3. Verify it still embeds:  tools/embed-smoke/run.sh
EOF
