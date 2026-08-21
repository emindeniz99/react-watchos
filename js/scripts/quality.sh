#!/usr/bin/env bash
# The code-quality battery, runnable locally: `pnpm --filter react-watchos quality`.
#
# Same tools, same flags as the `quality` job in .github/workflows/quality.yml —
# that workflow calls THIS script, so there is one place to change a flag and no
# copy to rot. What CI adds on top is only the environment: it installs the three
# standalone binaries (shellcheck, typos, lychee) and sets REQUIRE_ALL_TOOLS=1 so
# a missing one FAILS instead of being skipped.
#
# Locally, a missing binary is a skip with a notice — the same posture as
# REQUIRE_QJS in the vitest suite: contributors get the Node-side checks for free
# and are never blocked on a `brew install`.
#
# Not here on purpose:
#   * biome / tsc / vitest — already `pnpm lint`, `typecheck`, `test`.
#   * the weekly EXTERNAL link check — it needs the network, so it lives in
#     quality.yml on a schedule where a dead third-party URL cannot fail a PR.
#   * the pre-push hook — it must stay fast; this is a separate, explicit run.
set -euo pipefail

here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
js=$(dirname "$here")
root=$(dirname "$js")

require_all=${REQUIRE_ALL_TOOLS:-0}
failed=0
skipped=0

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

# True when $1 is runnable; otherwise records a skip (or a failure under
# REQUIRE_ALL_TOOLS) and returns false so the caller skips its command.
have() {
  if command -v "$1" >/dev/null 2>&1; then
    return 0
  fi
  if [ "$require_all" = "1" ]; then
    echo "ERROR: $1 is not installed and REQUIRE_ALL_TOOLS=1." >&2
    failed=1
  else
    echo "SKIP: $1 not installed (set REQUIRE_ALL_TOOLS=1 to make this fatal)."
    skipped=$((skipped + 1))
  fi
  return 1
}

# ---------------------------------------------------------------------------
# publint + attw, against a REAL tarball.
#
# Both linters read the published artifact, not the working tree: the `files`
# allowlist, the compiled dist-node/ and the exports map only agree in the
# tarball. Packing also runs `prepare`, so dist-node/ in the tarball is built
# from the sources being linted rather than from whatever was left over.
# ---------------------------------------------------------------------------
pack_dir=$(mktemp -d)
trap 'rm -rf "$pack_dir"' EXIT

step "pack (the artifact publint + attw lint)"
(cd "$js" && pnpm pack --pack-destination "$pack_dir" >/dev/null)
# Read the name back off disk rather than parsing pnpm's stdout: `prepare` runs
# during the pack and prints its own lines, so the tarball path is not reliably
# the last one. $pack_dir is a fresh mktemp, so there is exactly one .tgz in it.
tarball=""
for t in "$pack_dir"/*.tgz; do tarball=$t; done
if [ ! -f "$tarball" ]; then
  echo "ERROR: pnpm pack produced no tarball in $pack_dir" >&2
  exit 1
fi
ls -l "$tarball"

step "publint (packaging correctness)"
# --strict: publint's warnings are things that break a real consumer's import,
# not style. Zero is the baseline this was adopted at.
"$js/node_modules/.bin/publint" run "$tarball" --strict || failed=1

step "attw (types resolve for every exports entry)"
# --profile esm-only  ignores the node10 and node16-CJS resolution modes.
#   node10 is pre-exports-map Node (<=12) and `engines.node` is ">=22.18".
#   node16-CJS reports "ESM, dynamic import only" for a package that is
#   "type": "module" by design — and on the Node this package supports,
#   `require()` of ESM works natively (unflagged since 22.12) anyway.
#
# --ignore-rules internal-resolution-error  is the one broad suppression, and
#   it is inherent to the design rather than a defect: this package ships its
#   TYPESCRIPT SOURCE as its types (`types` -> ./src/index.ts), and that source
#   uses extensionless relative specifiers because consumers resolve it through
#   Metro/esbuild with `moduleResolution: bundler`. Under node16 those
#   specifiers do not resolve — a mode no consumer can use, since Node cannot
#   import a .ts file at all. attw cannot scope a rule to one entrypoint, so it
#   is off globally; the failure mode it would otherwise catch for us (an
#   exports target that isn't in the tarball) is covered by
#   test/packaging.test.ts, which asserts every exports target exists.
#
# --exclude-entrypoints  the three Expo config-plugin / post-prebuild entries.
#   They are resolved BY PATH STRING out of app.json and a package.json script
#   and are never type-imported, so "no types" is the correct shape for them.
"$js/node_modules/.bin/attw" "$tarball" \
  --profile esm-only \
  --ignore-rules internal-resolution-error \
  --exclude-entrypoints ./app.plugin ./link-swift-package ./merge-target-infoplist ||
  failed=1

step "knip (dead files, exports and dependencies)"
(cd "$js" && node_modules/.bin/knip --no-progress) || failed=1

step "dependency-cruiser (QuickJS/Node module boundaries)"
(cd "$js" && node_modules/.bin/depcruise --config .dependency-cruiser.mjs \
  src esbuild plugin codegen scripts bin demo test) || failed=1

# ---------------------------------------------------------------------------
# Standalone binaries. Skipped-with-a-notice locally, required in CI.
# ---------------------------------------------------------------------------
step "shellcheck (every tracked shell script)"
# Tracked .sh files plus the hook, which has no extension. Listed via
# `git ls-files` so a newly added script is covered without editing this file.
if have shellcheck; then
  shell_files=()
  while IFS= read -r f; do shell_files+=("$f"); done < <(
    cd "$root" && git ls-files '*.sh'
  )
  (cd "$root" && shellcheck -x "${shell_files[@]}" .githooks/pre-push) || failed=1
fi

step "typos (source, comments and docs)"
# Config + the whole allowlist rationale: _typos.toml at the repo root.
if have typos; then
  (cd "$root" && typos) || failed=1
fi

step "lychee (internal links + anchors, offline)"
# --offline: only repo-relative file links and in-document #anchors. No network,
# so this is deterministic and safe as a PR gate. The external half runs weekly
# in quality.yml. Config + exclusions: lychee.toml at the repo root.
if have lychee; then
  (cd "$root" && lychee --offline --no-progress \
    '*.md' 'docs/**/*.md' 'notes/*.md' '.github/**/*.md' 'js/*.md' \
    'js/swift/*.md' 'examples/*/*.md') || failed=1
fi

printf '\n'
if [ "$failed" -ne 0 ]; then
  echo "quality: FAILED" >&2
  exit 1
fi
if [ "$skipped" -ne 0 ]; then
  echo "quality: OK ($skipped check(s) skipped — tool not installed)"
else
  echo "quality: OK"
fi
