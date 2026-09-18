#!/usr/bin/env sh
# Prove the vendored engine is byte-identical to the upstream commit it
# claims, and that upstream's tag still names that commit.
#
# WHY THIS EXISTS, given CHECKSUMS.sha256 already exists: that manifest is
# self-referential. It says "these files hash to these values", and
# `vendor-integrity.test.ts` checks exactly that — so anyone who edits an
# engine source and regenerates the manifest passes it. It detects accident
# (a stray edit, a bad merge, a truncated copy), not intent.
#
# The gate that detects intent is `engine-attest.yml`, and it only fires on
# `pull_request`: a change pushed straight to main never meets it. That hole
# is the reason for this script. It answers two questions, against an
# authority outside this repository:
#
#     are our bytes this commit's bytes?
#     does upstream's tag still name this commit?
#
# The first is answered from quickjs-ng's own git objects, fetched by the SHA
# on VERSION.md's `Upstream commit:` line (GitHub serves a fetch by bare SHA;
# verified 2026-09-18) — not the generated archive run.sh downloads, and not
# the tag, which is a mutable pointer: cloning the tag would compare our bytes
# against whatever the tag names TODAY and report OK after a retag. Content-
# addressed objects, chained to a commit id anyone can check against any
# mirror or fork. The second is answered by resolve-tag.sh over the git
# protocol, so a moved or deleted tag turns security.yml on main and engine
# attest on a PR red until a human re-vendors — with no override there, on
# purpose: a retag after we vendored is the one event nothing else in this
# repo can see. release.yml's publish runs with VERIFY_TAG_BINDING=warn: the
# bytes it ships are proved against the commit above, and which release
# upstream now calls them is main's alarm, not a reason to strand a release
# (a red gate on a tag is a dead version — 0.9.0, 2026-09-18).
#
# Usage:  sh tools/vendor-quickjs/verify-upstream.sh
# Env:    VERIFY_TAG_BINDING=warn — report a moved tag, do not fail on it
# Exit:   0 identical and bound · 1 mismatch, missing file, missing commit
#         line, tag disagreement, or (unless warn) a tag that no longer names
#         the commit
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

COMMIT=$(sed -n 's/^Upstream commit: \([0-9a-f]\{40\}\).*/\1/p' "$VENDOR/VERSION.md")
if [ -z "$COMMIT" ]; then
  echo "FATAL: VERSION.md has no \`Upstream commit: <40 hex>\` line." >&2
  echo "Re-vendor with: sh tools/vendor-quickjs/run.sh <tag> <commit> <tarball-sha256>" >&2
  exit 1
fi
echo "vendored commit: $COMMIT"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "fetching upstream git objects at $COMMIT (not the tag, not the generated archive)"
git init -q "$TMP/upstream"
git -C "$TMP/upstream" fetch -q --depth 1 "$UPSTREAM_REPO" "$COMMIT"
git -C "$TMP/upstream" -c advice.detachedHead=false checkout -q FETCH_HEAD
UPSTREAM_SHA=$(git -C "$TMP/upstream" rev-parse HEAD)
if [ "$UPSTREAM_SHA" != "$COMMIT" ]; then
  echo "FATAL: asked upstream for $COMMIT and got $UPSTREAM_SHA." >&2
  exit 1
fi

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
    echo "  MISSING UPSTREAM: $path (looked for $upstream_path at $TAG @ $COMMIT)" >&2
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
  echo "FATAL: $mismatches file(s) differ from quickjs-ng $TAG @ $COMMIT." >&2
  echo "The vendored engine executes every signed OTA bundle. Do not 'fix' this" >&2
  echo "by regenerating CHECKSUMS.sha256 — that manifest is self-referential and" >&2
  echo "would go green over the same bytes. Re-vendor from upstream with" >&2
  echo "tools/vendor-quickjs/run.sh, or explain the divergence before shipping." >&2
  exit 1
fi

echo "OK: $compared vendored file(s) are byte-identical to quickjs-ng $TAG @ $COMMIT"

# The binding, checked last and separately so its failure reads as its own
# event. A missing tag resolves to nothing and is reported the same way.
if ! resolved=$(sh "$REPO_ROOT/tools/vendor-quickjs/resolve-tag.sh" "$TAG"); then
  resolved=""
fi
if [ "$resolved" != "$COMMIT" ]; then
  if [ "${VERIFY_TAG_BINDING:-fatal}" = warn ]; then
    echo "WARNING: upstream's $TAG no longer names $COMMIT (now ${resolved:-nothing}) — the" >&2
    echo "tag moved after we vendored it. The bytes above are still that commit's;" >&2
    echo "re-vendor deliberately with run.sh." >&2
    exit 0
  fi
  echo "FATAL: upstream's $TAG no longer names $COMMIT (now ${resolved:-nothing}) — the tag" >&2
  echo "moved after we vendored it. Re-vendor deliberately with run.sh; there is" >&2
  echo "no override here, on purpose." >&2
  exit 1
fi

echo "OK: upstream's $TAG still names $COMMIT"
