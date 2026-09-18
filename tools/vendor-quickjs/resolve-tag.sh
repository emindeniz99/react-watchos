#!/bin/sh
# Prints the commit an upstream quickjs-ng tag names, or exits 1 if the tag
# does not exist. It asks over the git protocol with no token, so the bot's
# push job and a human on any machine get the same answer from the same eight
# lines — which is what makes a retag between propose and push a refused push
# instead of a silent one. quickjs-ng's tags were lightweight on 2026-09-18;
# the `^{}` branch exists for the day that changes (an annotated tag's plain
# line is the tag object, its `^{}` line is the commit).
#
# Usage:  sh tools/vendor-quickjs/resolve-tag.sh v0.16.2
set -eu

TAG="${1:-}"
[ -n "$TAG" ] || { echo "usage: $0 <tag>" >&2; exit 1; }

refs=$(git ls-remote --tags https://github.com/quickjs-ng/quickjs.git \
  "refs/tags/$TAG" "refs/tags/$TAG^{}")
if [ -z "$refs" ]; then
  echo "resolve-tag: upstream has no tag $TAG" >&2
  exit 1
fi
peeled=$(printf '%s\n' "$refs" | awk '$2 ~ /\^\{\}$/ { print $1 }')
plain=$(printf '%s\n' "$refs" | awk '$2 !~ /\^\{\}$/ { print $1 }')
printf '%s\n' "${peeled:-$plain}"
