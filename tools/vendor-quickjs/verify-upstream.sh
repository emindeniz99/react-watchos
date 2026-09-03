#!/usr/bin/env sh
# Prove the vendored engine is byte-identical to upstream at the tag it claims.
#
# WHY THIS EXISTS, given CHECKSUMS.sha256 already exists: that manifest is
# self-referential. It says "these files hash to these values", and
# `vendor-integrity.test.ts` checks exactly that — so anyone who edits an
# engine source and regenerates the manifest passes it. It detects accident
# (a stray edit, a bad merge, a truncated copy), not intent.
#
# The gate that detects intent is `engine-attest.yml`, and it only fires on
# `pull_request`: a change pushed straight to main never meets it. That hole
# is the reason for this script. It answers a different question, against an
# authority outside this repository:
#
#     are our bytes upstream's bytes?
#
# It fetches quickjs-ng's own git objects at the tag VERSION.md names — not
# the generated archive tarball run.sh downloads, which is a second
# representation of the same tree — and compares every file the vendor script
# copies. Content-addressed objects, chained to a commit id anyone can check
# against any mirror or fork. No human, no label, no second channel to
# remember: it can run on every push, and in the publish job, where it stops a
# tampered engine from reaching npm even if it reached main.
#
# Usage:  sh tools/vendor-quickjs/verify-upstream.sh
# Exit:   0 identical · 1 mismatch, missing file, or tag disagreement
set -eu

REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
VENDOR="$REPO_ROOT/js/swift/Sources/CQuickJS"
UPSTREAM_REPO="https://github.com/quickjs-ng/quickjs.git"

# OURS, not upstream's — the vendor script writes or preserves these, so they
# have no counterpart to compare against. Keep in lockstep with run.sh: the
# .h loop skips the shim, and VERSION.md/CHECKSUMS.sha256 are generated here.
is_ours() {
  case "$1" in
    VERSION.md | CHECKSUMS.sha256 | include/quickjs-swift-shim.h | include/module.modulemap)
      return 0 ;;
    *) return 1 ;;
  esac
}

# The tag is stated in two independent places. They must agree: VERSION.md is
# prose the bump script rewrites, quickjs.h's macros are upstream's own claim
# about itself, and a disagreement means one of them was edited by hand.
tag_from_version_md() {
  sed -n '1s/^# Vendored: quickjs-ng \(v[0-9][0-9.]*\).*/\1/p' "$VENDOR/VERSION.md"
}
tag_from_header() {
  major=$(sed -n 's/^#define QJS_VERSION_MAJOR *\([0-9]*\).*/\1/p' "$VENDOR/include/quickjs.h")
  minor=$(sed -n 's/^#define QJS_VERSION_MINOR *\([0-9]*\).*/\1/p' "$VENDOR/include/quickjs.h")
  patch=$(sed -n 's/^#define QJS_VERSION_PATCH *\([0-9]*\).*/\1/p' "$VENDOR/include/quickjs.h")
  [ -n "$major" ] && printf 'v%s.%s.%s\n' "$major" "$minor" "$patch"
}

TAG=$(tag_from_version_md)
HEADER_TAG=$(tag_from_header || true)
if [ -z "$TAG" ]; then
  echo "FATAL: could not read the vendored tag from VERSION.md's first line." >&2
  exit 1
fi
if [ -n "$HEADER_TAG" ] && [ "$TAG" != "$HEADER_TAG" ]; then
  echo "FATAL: the vendored tag disagrees with itself." >&2
  echo "  VERSION.md: $TAG" >&2
  echo "  quickjs.h:  $HEADER_TAG" >&2
  exit 1
fi
echo "vendored tag: $TAG (VERSION.md and quickjs.h agree)"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "fetching upstream git objects at $TAG (not the generated archive)"
git clone --quiet -c advice.detachedHead=false --depth 1 --branch "$TAG" "$UPSTREAM_REPO" "$TMP/upstream"
UPSTREAM_SHA=$(git -C "$TMP/upstream" rev-parse HEAD)
echo "upstream commit: $UPSTREAM_SHA"

mismatches=0
compared=0
# Walk what WE ship, not what upstream has: a file we vendor and upstream no
# longer publishes is exactly the drift worth failing on, and the reverse
# (upstream growing a file we do not compile) is not our business.
for path in $(cd "$VENDOR" && find . -type f | sed 's|^\./||' | sort); do
  if is_ours "$path"; then
    continue
  fi
  # Headers live under include/ here and at the repo root upstream.
  upstream_path=${path#include/}
  if [ ! -f "$TMP/upstream/$upstream_path" ]; then
    echo "  MISSING UPSTREAM: $path (looked for $upstream_path at $TAG)" >&2
    mismatches=$((mismatches + 1))
    continue
  fi
  ours=$(shasum -a 256 "$VENDOR/$path" | cut -d' ' -f1)
  theirs=$(shasum -a 256 "$TMP/upstream/$upstream_path" | cut -d' ' -f1)
  compared=$((compared + 1))
  if [ "$ours" != "$theirs" ]; then
    echo "  MISMATCH: $path" >&2
    echo "    ours:     $ours" >&2
    echo "    upstream: $theirs" >&2
    mismatches=$((mismatches + 1))
  fi
done

if [ "$mismatches" -ne 0 ]; then
  echo "" >&2
  echo "FATAL: $mismatches file(s) differ from quickjs-ng $TAG ($UPSTREAM_SHA)." >&2
  echo "The vendored engine executes every signed OTA bundle. Do not 'fix' this" >&2
  echo "by regenerating CHECKSUMS.sha256 — that manifest is self-referential and" >&2
  echo "would go green over the same bytes. Re-vendor from upstream with" >&2
  echo "tools/vendor-quickjs/run.sh, or explain the divergence before shipping." >&2
  exit 1
fi

echo "OK: $compared vendored file(s) are byte-identical to quickjs-ng $TAG"
