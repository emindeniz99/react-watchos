#!/bin/sh
# EXPERIMENT (see README.md) — runs the SAME production bundle and the SAME
# smoke epilogue through both engines on one machine and prints the two side by
# side on the numbers this repo already gates on.
#
# Everything measured here is printed by the hosts themselves (the [mem] and
# [boot] lines) — this script adds no instrumentation, it just repeats the run
# and takes a MEDIAN. Medians, not single runs: parse/eval are wall-clock on
# dev hardware, and a single sample of a ~30 ms window on a shared machine is
# noise (the FIRST jsc-host run of a session reports ~63 ms against a 33 ms
# median, all of it cold page-in of a 16 MB binary). Same reason embed-smoke's
# boot tripwire is deliberately loose.
#
# THE COLUMNS ARE NOT THE SAME SHAPE FOR THE TWO ENGINES, and that is a finding
# rather than sloppiness:
#
#   quickjs-ng  compiles with JS_EVAL_FLAG_COMPILE_ONLY and then evaluates the
#               resulting function, so `parse` and `total` are two clocks around
#               two calls, and `parse` really is the whole parse.
#   JSC         has NO compile-without-run entry point in its public C API, so
#               `total` is one JSEvaluateScript that parses AND runs, and
#               `parse` comes from a SEPARATE process (jsc-host --parse-only,
#               JSCheckScriptSyntax) — running the check first in the same VM
#               would warm the SourceProviderCache and make the eval that
#               follows measure a warm parse. On top of that JSC compiles
#               function bodies LAZILY, so its `parse` is not the same work as
#               quickjs-ng's: the rest of it happens inside `total`.
#
# So `total` is the column to compare; treat `parse` as indicative on the JSC
# side, never as a term of a subtraction.
#
# The "empty script" rows are the engine FLOOR — a context created, a `1`
# evaluated, nothing else. Subtract them mentally to see what this repo's
# bundle costs on top of simply having the engine in the process.
#
# usage: measure.sh [runs]   (default 21 — odd, so the median is a real sample)
set -eu

cd "$(dirname "$0")"
RUNS="${1:-21}"
OUT=out
BUNDLE=../../js/dist/bundle.js
EPILOGUE=smoke-epilogue.js

# Always rebuild, MINIFIED — deliberately unlike tools/embed-smoke/run.sh, which
# only builds when the bundle is missing. `js/dist/bundle.js` is whatever the
# last `build` or `build:min` left there (a 3x difference in parse work), and a
# benchmark whose input silently changes size between runs is not a benchmark.
# The minified bundle is the shipping shape, so that is the one measured. Set
# JSC_SKIP_BUILD=1 to measure the bundle already on disk instead.
if [ -z "${JSC_SKIP_BUILD:-}" ]; then
    (cd ../.. && pnpm --filter react-watchos build:min >/dev/null)
fi
sh build-hosts.sh

# The engine floor: the smallest input each host will accept. `1` is a complete
# program; the epilogue only has to produce a string, and embed-host.c installs
# __commits/__timers itself so nothing else is needed.
printf '1\n' >"$OUT/empty.js"
printf 'JSON.stringify({})\n' >"$OUT/empty-epilogue.js"

# The PRODUCTION path for quickjs-ng — the watch boots .qbc, not source. There
# is deliberately no JSC counterpart: JSC's C API cannot serialize bytecode at
# all (README.md Stage 2), so this row has one side by construction.
"$OUT/qjs-compile" "$BUNDLE" "$OUT/measure.qbc" >/dev/null 2>&1

median() {
    sort -g | awk '{ v[NR] = $1 } END { if (NR) printf "%.1f\n", v[int((NR + 1) / 2)] }'
}

# Runs a host `RUNS` times and prints tagged samples, one per line.
sample() {
    i=0
    while [ "$i" -lt "$RUNS" ]; do
        "$@" 2>&1 >/dev/null | sed -n \
            -e 's/^\[boot\] [a-z]* \([0-9.]*\) ms + eval \([0-9.]*\) ms.* \([0-9.]*\) ms total/P \1\nT \3/p' \
            -e 's/^\[boot\] load \([0-9.]*\) ms.*/T \1/p' \
            -e 's/^\[boot\] parse \([0-9.]*\) ms (JSCheck.*/P \1/p' \
            -e 's/^\[mem\] quickjs heap: \([0-9.]*\) MB, process peak rss: \([0-9]*\).*/H \1\nR \2/p' \
            -e 's/^\[mem\] jsc heap: \([0-9.]*\) MB, after gc: \([0-9.]*\) MB.*peak rss: \([0-9]*\).*/H \1\nG \2\nR \3/p'
        i=$((i + 1))
    done
}

pick() { sed -n "s/^$1 //p" | median; }

# $2 is the parse cell: empty means "read it out of this host's own [boot]
# line" (quickjs-ng prints one), anything else is printed literally — which is
# how the JSC row gets its number from a separate --parse-only process, and how
# rows with no meaningful parse get a "-".
dash() { v="$(cat)"; [ -n "$v" ] && printf '%s\n' "$v" || printf -- '-\n'; }

row() {
    label="$1"
    parse="$2"
    shift 2
    raw="$(sample "$@")"
    [ -n "$parse" ] || parse="$(printf '%s\n' "$raw" | pick P | dash)"
    printf '%-32s %8s %8s %9s %9s %10s\n' "$label" \
        "$parse" \
        "$(printf '%s\n' "$raw" | pick T | dash)" \
        "$(printf '%s\n' "$raw" | pick H | dash)" \
        "$(printf '%s\n' "$raw" | pick G | dash)" \
        "$(printf '%s\n' "$raw" | pick R | dash)"
}

echo
printf 'median of %s runs, same machine, same bundle (%s B), same epilogue\n' \
    "$RUNS" "$(wc -c <"$BUNDLE")"
printf '%-32s %8s %8s %9s %9s %10s\n' \
    "engine / input" "parse" "total" "heap MB" "gc MB" "rss KB"
printf '%-32s %8s %8s %9s %9s %10s\n' \
    "--------------------------------" "--------" "--------" "---------" "---------" "----------"

row "quickjs-ng   empty script" "" "$OUT/embed-host-qjsng" "$OUT/empty.js" "$OUT/empty-epilogue.js"
row "quickjs-ng   bundle source" "" "$OUT/embed-host-qjsng" "$BUNDLE" "$EPILOGUE"
row "quickjs-ng   bundle .qbc (ships)" "" "$OUT/embed-host-qjsng" "$OUT/measure.qbc" "$EPILOGUE"
row "jsc jitless  empty script" "-" "$OUT/jsc-host" "$OUT/empty.js" "$OUT/empty-epilogue.js"
# The JSC parse cell is filled from its own process; see the header.
row "jsc jitless  bundle source" "$(sample "$OUT/jsc-host" --parse-only "$BUNDLE" | pick P)" \
    "$OUT/jsc-host" "$BUNDLE" "$EPILOGUE"

echo
printf 'bundle  %s B source   %s B .qbc (quickjs-ng; JSC has no equivalent)\n' \
    "$(wc -c <"$BUNDLE")" "$(wc -c <"$OUT/measure.qbc")"
echo
echo 'NOTE: quickjs-ng "total" = parse + eval (two calls). JSC "total" = one'
echo '      JSEvaluateScript, which parses AND runs; its "parse" column comes'
echo '      from a separate --parse-only process and is a LAZY parse. See the'
echo '      header of this file before comparing the parse column.'
echo 'NOTE: quickjs-ng heap = JS_ComputeMemoryUsage().memory_used_size, a PUBLIC'
echo '      API. JSC heap = JSGetMemoryUsageStatistics().heapSize, which lives in'
echo '      JSBasePrivate.h — SPI on Apple platforms. "gc MB" is the same field'
echo '      after a forced JSGarbageCollect. See README.md Stage 3.'
echo 'NOTE: ICU is linked DYNAMICALLY here and therefore counted in neither the'
echo '      rss nor the size numbers. JSC requires it (there is no ENABLE_INTL'
echo '      off switch); quickjs-ng carries its own 250 KB libunicode.c.'
