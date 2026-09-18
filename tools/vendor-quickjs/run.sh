#!/bin/sh
# Re-vendors quickjs-ng into js/swift/Sources/CQuickJS for a new upstream
# release. Maintenance helper — run by hand when bumping the engine, not part
# of the build.
#
# Usage:  ./run.sh v0.16.0 <commit> <tarball-sha256>
#
# The COMMIT is the durable identity: a release tag is a mutable pointer, so
# the same tag downloaded on two days can be two trees. Resolve it from a
# machine that is not the one downloading (`sh tools/vendor-quickjs/resolve-tag.sh
# <tag>`), and the archive is fetched by that commit — GitHub's
# `archive/<sha>.tar.gz` — which nobody can move. verify-upstream.sh later
# proves the vendored bytes are that commit's git objects and that upstream's
# tag still names it.
#
# The SHA-256 is REQUIRED too (M9): the vendored engine is the app's entire
# trust base — it executes every signed OTA bundle — so a bare `curl | tar`
# would graft a MITM'd tarball straight into it. It is the same-download
# integrity check, not a claim about upstream: GitHub does not promise archive
# bytes are stable across generator changes, so hash the archive on the day
# you vendor and pass it here; the download fails loudly on any mismatch.
#
# What it does, and only this:
#   1. downloads the upstream source archive at the commit and VERIFIES its
#      SHA-256
#   2. overwrites the four compiled sources — the upstream `qjs_sources` set
#      (quickjs.c libregexp.c libunicode.c dtoa.c) — at the CQuickJS root
#   3. refreshes every header we already vendor under include/, by name, so the
#      curated set is preserved and nothing new (quickjs-libc.h, xsum.*, …)
#      sneaks in
#   4. refreshes the upstream LICENSE
#   5. bumps the version line + upstream commit + source URL + tarball digest
#      in VERSION.md
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
COMMIT="$2"
EXPECTED_SHA="$3"
[ -n "$TAG" ] || { echo "usage: $0 <tag> <commit> <tarball-sha256>   e.g. $0 v0.16.0 1ab8676… abc123…" >&2; exit 1; }
case "$COMMIT" in
  *[!0-9a-f]* | "") COMMIT="" ;;
esac
if [ "${#COMMIT}" -ne 40 ]; then
  echo "error: the upstream commit (40 hex) is required — the tag is a mutable pointer." >&2
  echo "Resolve it from a machine that is not the one downloading:" >&2
  echo "  sh tools/vendor-quickjs/resolve-tag.sh $TAG" >&2
  echo "then re-run:  $0 $TAG <commit> <sha256>" >&2
  exit 1
fi
[ -n "$EXPECTED_SHA" ] || {
  echo "error: the tarball SHA-256 is required (M9 — no unverified engine)." >&2
  echo "Hash the archive at the commit, e.g.:" >&2
  echo "  curl -fsSL https://github.com/quickjs-ng/quickjs/archive/$COMMIT.tar.gz | shasum -a 256" >&2
  echo "then re-run:  $0 $TAG $COMMIT <sha256>" >&2
  exit 1
}

VENDOR=../../js/swift/Sources/CQuickJS
URL="https://github.com/quickjs-ng/quickjs/archive/$COMMIT.tar.gz"

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
# The commit-form archive extracts to quickjs-<sha>; the glob tolerates either naming.
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

echo "bumping VERSION.md to $TAG @ $COMMIT"
# Fail, don't insert: verify-upstream.sh and engine attest parse the commit
# line and fail closed without it, so its absence is a hand edit to surface.
if ! grep -q "^Upstream commit: " "$VENDOR/VERSION.md"; then
  echo "FATAL: VERSION.md carries no \`Upstream commit:\` line — add one; verify-upstream.sh and engine attest fail without it" >&2
  exit 1
fi
# Every expression is anchored to its provenance line: the update steps
# further down quote the same `archive/<commit>.tar.gz` shape as a
# placeholder, and an unanchored sed baked the commit into it.
sed -i.bak \
  -e "1s|.*|# Vendored: quickjs-ng $TAG|" \
  -e "s|^Upstream commit: .*|Upstream commit: $COMMIT|" \
  -e "s|^Source: .*|Source: https://github.com/quickjs-ng/quickjs/archive/$COMMIT.tar.gz|" \
  "$VENDOR/VERSION.md"
rm -f "$VENDOR/VERSION.md.bak"
grep -q "^Source: .*archive/$COMMIT.tar.gz" "$VENDOR/VERSION.md" || {
  echo "FATAL: VERSION.md's Source line did not take the commit URL — fix the line by hand" >&2
  exit 1
}
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

Done — vendored quickjs-ng $TAG @ $COMMIT (tarball $ACTUAL_SHA).
Next:
  1. Review the prose in $VENDOR/VERSION.md (the qjs_sources note may need an
     update if upstream changed which files compile; js/swift/README.md
     links here and needs no edit).
  2. Verify it still embeds:  tools/embed-smoke/run.sh
  3. Run the manifest gate:   cd js && pnpm vitest run test/vendor-integrity
  4. Prove the tree is that commit's, and that the tag still names it:
     sh tools/vendor-quickjs/verify-upstream.sh
EOF
