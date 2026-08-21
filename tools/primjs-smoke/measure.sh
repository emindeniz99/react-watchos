#!/bin/sh
# EXPERIMENT (see README.md) — runs the SAME production bundle through the same
# host, once linked to quickjs-ng and once to PrimJS, and prints the two side by
# side on the numbers this repo already gates on.
#
# Everything measured here is printed by the hosts themselves
# (tools/embed-smoke/embed-host.c's [mem] and [boot] lines) — this script adds
# no instrumentation, it just repeats the run and takes a MEDIAN. Medians, not
# single runs: parse/eval are wall-clock on dev hardware, and a single sample of
# a ~30 ms window on a shared machine is noise. Same reason embed-smoke's boot
# tripwire is deliberately loose.
#
# usage: measure.sh [runs]   (default 21 — odd, so the median is a real sample)
set -eu

cd "$(dirname "$0")"
RUNS="${1:-21}"
OUT=out
BUNDLE=../../js/dist/bundle.js

# Always rebuild, MINIFIED — deliberately unlike tools/embed-smoke/run.sh, which
# only builds when the bundle is missing. `js/dist/bundle.js` is whatever the
# last `build` or `build:min` left there (627 KB unminified vs 202 KB minified,
# a 3x difference in parse work), and a benchmark whose input silently changes
# size between runs is not a benchmark. The minified bundle is the shipping
# shape, so that is the one measured. Set PRIMJS_SKIP_BUILD=1 to measure the
# bundle already on disk instead.
if [ -z "${PRIMJS_SKIP_BUILD:-}" ]; then
    (cd ../.. && pnpm --filter react-watchos build:min >/dev/null)
fi
sh build-hosts.sh

# Each engine gets bytecode written by ITS OWN compiler. Mixing them is not an
# option and that is a finding, not a limitation of this script: the two write
# incompatible blobs (different serialization version, different flag set), so
# "run quickjs-ng's .qbc on PrimJS" has no meaning.
"$OUT/qjs-compile-qjsng" "$BUNDLE" "$OUT/measure-qjsng.qbc" >/dev/null 2>&1
"$OUT/qjs-compile-primjs" "$BUNDLE" "$OUT/measure-primjs.qbc" >/dev/null 2>&1

median() {
    sort -g | awk '{ v[NR] = $1 } END { if (NR) printf "%.1f\n", v[int((NR + 1) / 2)] }'
}

# Runs one host `RUNS` times and prints: phase1_ms eval_ms heap_mb rss_kb
sample() {
    host="$1"
    input="$2"
    i=0
    while [ "$i" -lt "$RUNS" ]; do
        "./$host" "$input" 2>&1 >/dev/null | sed -n \
            -e 's/^\[boot\] [a-z]* \([0-9.]*\) ms + eval \([0-9.]*\) ms.*/P \1\nE \2/p' \
            -e 's/^\[mem\] quickjs heap: \([0-9.]*\) MB, process peak rss: \([0-9]*\).*/H \1\nR \2/p'
        i=$((i + 1))
    done
}

report() {
    label="$1"
    host="$2"
    input="$3"
    raw="$(sample "$host" "$input")"
    p=$(printf '%s\n' "$raw" | sed -n 's/^P //p' | median)
    e=$(printf '%s\n' "$raw" | sed -n 's/^E //p' | median)
    h=$(printf '%s\n' "$raw" | sed -n 's/^H //p' | median)
    r=$(printf '%s\n' "$raw" | sed -n 's/^R //p' | median)
    printf '%-26s %8s %8s %9s %10s\n' "$label" "$p" "$e" "$h" "$r"
}

echo
printf 'median of %s runs, same machine, same bundle (%s B)\n' \
    "$RUNS" "$(wc -c <"$BUNDLE")"
printf '%-26s %8s %8s %9s %10s\n' "engine / path" "phase1" "eval" "heap MB" "rss KB"
printf '%-26s %8s %8s %9s %10s\n' "--------------------------" "--------" "--------" "---------" "----------"
report "quickjs-ng  source" "$OUT/embed-host-qjsng" "$BUNDLE"
report "primjs      source" "$OUT/embed-host-primjs" "$BUNDLE"
report "quickjs-ng  bytecode" "$OUT/embed-host-qjsng" "$OUT/measure-qjsng.qbc"
report "primjs      bytecode" "$OUT/embed-host-primjs" "$OUT/measure-primjs.qbc"
echo
printf 'bytecode blob   quickjs-ng %s B   primjs %s B\n' \
    "$(wc -c <"$OUT/measure-qjsng.qbc")" "$(wc -c <"$OUT/measure-primjs.qbc")"
printf 'engine archive  quickjs-ng %s B   primjs %s B\n' \
    "$(cat "$(sh ../vendored-qjs/build.sh --objdir 2>/dev/null)"/*.o | wc -c)" \
    "$(wc -c <"$(sh fetch-and-build.sh --libdir 2>/dev/null)/libquick.a")"
echo
echo 'NOTE: primjs "heap MB" is 0.0 by construction — LEPUS_ComputeMemoryUsage'
echo '      writes nothing unless the engine is built with the debugger. See'
echo '      README.md; LEPUS_GetHeapSize() is the working substitute.'
