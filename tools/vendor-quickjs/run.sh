#!/bin/sh
# Re-vendors quickjs-ng into js/swift/Sources/CQuickJS for a new upstream
# release. Maintenance helper — run by hand when bumping the engine, not part
# of the build.
#
# Usage:  ./run.sh v0.16.0 <tarball-sha256>
#
# The SHA-256 is REQUIRED (M9): the vendored engine is the app's entire trust
# base — it executes every signed OTA bundle — so a bare `curl | tar` would
# graft a compromised release asset or a MITM'd tarball straight into it. Get
# the digest through a second channel (the upstream release page, or hashing
# the tarball on a machine/network you trust) and pass it here; the download
# fails loudly on any mismatch.
#
# What it does, and only this:
#   1. downloads the upstream source tarball and VERIFIES its SHA-256
#   2. overwrites the four compiled sources — the upstream `qjs_sources` set
#      (quickjs.c libregexp.c libunicode.c dtoa.c) — at the CQuickJS root
#   3. refreshes every header we already vendor under include/, by name, so the
#      curated set is preserved and nothing new (quickjs-libc.h, xsum.*, …)
#      sneaks in
#   4. refreshes the upstream LICENSE
#   5. bumps the version line + source URL + tarball digest in VERSION.md
#   6. regenerates CHECKSUMS.sha256 — the per-file manifest that
#      js/test/vendor-integrity.test.ts pins on every `pnpm test`, so the
#      vendored tree can't drift silently BETWEEN re-vendors either
#
# It never overwrites quickjs-swift-shim.h (that header is ours) and never adds
# quickjs-libc / cutils.c — the watch app's only I/O is the JS `__host` bridge
# installed by JSRuntime.swift (see VERSION.md). If upstream changed which files
# compile, the qjs_sources list above and the prose in VERSION.md need a manual
# look; tools/embed-smoke/run.sh is the proof it still embeds.
set -e
cd "$(dirname "$0")"

TAG="$1"
EXPECTED_SHA="$2"
[ -n "$TAG" ] || { echo "usage: $0 <tag> <tarball-sha256>   e.g. $0 v0.16.0 abc123…" >&2; exit 1; }
[ -n "$EXPECTED_SHA" ] || {
  echo "error: the tarball SHA-256 is required (M9 — no unverified engine)." >&2
  echo "Obtain it out-of-band, e.g.:" >&2
  echo "  curl -fsSL https://github.com/quickjs-ng/quickjs/archive/refs/tags/$TAG.tar.gz | shasum -a 256" >&2
  echo "then re-run:  $0 $TAG <sha256>" >&2
  exit 1
}

VENDOR=../../js/swift/Sources/CQuickJS
URL="https://github.com/quickjs-ng/quickjs/archive/refs/tags/$TAG.tar.gz"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "downloading $URL"
curl -fsSL "$URL" -o "$TMP/src.tar.gz"

ACTUAL_SHA=$(shasum -a 256 "$TMP/src.tar.gz" | awk '{print $1}')
if [ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]; then
  echo "FATAL: tarball SHA-256 mismatch — refusing to vendor." >&2
  echo "  expected: $EXPECTED_SHA" >&2
  echo "  actual:   $ACTUAL_SHA" >&2
  exit 1
fi
echo "tarball SHA-256 verified: $ACTUAL_SHA"
tar -xz -C "$TMP" -f "$TMP/src.tar.gz"
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
# Record (or refresh) the verified tarball digest in VERSION.md.
if grep -q "^Tarball SHA-256:" "$VENDOR/VERSION.md"; then
  sed -i.bak "s|^Tarball SHA-256:.*|Tarball SHA-256: $ACTUAL_SHA|" "$VENDOR/VERSION.md"
  rm -f "$VENDOR/VERSION.md.bak"
else
  printf '\nTarball SHA-256: %s\n' "$ACTUAL_SHA" >> "$VENDOR/VERSION.md"
fi

echo "regenerating CHECKSUMS.sha256 (pinned by vendor-integrity.test.ts)"
(
  cd "$VENDOR"
  for f in LICENSE dtoa.c libregexp.c libunicode.c quickjs.c \
    include/*.h include/module.modulemap; do
    shasum -a 256 "$f"
  done > CHECKSUMS.sha256
)

cat <<EOF

Done — vendored quickjs-ng $TAG (tarball $ACTUAL_SHA).
Next:
  1. Review the prose in $VENDOR/VERSION.md (the qjs_sources note may need an
     update if upstream changed which files compile).
  2. Bump the version in js/swift/README.md.
  3. Verify it still embeds:  tools/embed-smoke/run.sh
  4. Run the manifest gate:   cd js && pnpm vitest run test/vendor-integrity
EOF
