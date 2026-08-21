#!/bin/sh
# EXPERIMENT (see README.md) — links the two hosts that get measured against
# each other:
#
#   out/embed-host-qjsng   tools/embed-smoke/embed-host.c, UNMODIFIED, against
#                          the vendored quickjs-ng (the baseline every gate uses)
#   out/jsc-host           ./jsc-host.c against the self-built jitless JSCOnly
#
# Both are compiled by the SAME compiler at the SAME -O level so the host code
# is not a variable. The ENGINES are each built with their own project's flags
# — quickjs-ng at -O2 via tools/vendored-qjs/build.sh, JSC at -O3 via WebKit's
# own Release configuration — because "the engine as its maintainers ship it"
# is the thing under comparison. That asymmetry is stated in README.md rather
# than papered over.
#
# Nothing here touches the binary tools/embed-smoke/run.sh builds; out/ is
# gitignored.
#
# Also emits the size numbers README.md's Stage 3 table reports, because they
# are a property of THIS link and would go stale in a hand-written table:
# the engine archives, and each host stripped, linked twice — once plainly and
# once with --gc-sections.
#
# WHY both link modes: WebKit compiles with -ffunction-sections -fdata-sections
# so a linker asked to garbage-collect sections can drop what the embedding
# never calls; the vendored quickjs-ng is compiled without them (plain -O2 in
# tools/vendored-qjs/build.sh), so --gc-sections cannot help it nearly as much.
# Apple's linker dead-strips at function granularity by default via its atom
# model, so the --gc-sections row is the closer analogue of a watchOS app link
# and the plain row is the closer analogue of "what these archives contain".
# Reporting one alone would flatter one engine.
set -eu

cd "$(dirname "$0")"
OUT=out
mkdir -p "$OUT"

CC_BIN="${JSC_HOST_CC:-clang}"
CFLAGS="-O2 -std=gnu11 -DNDEBUG"

JSC_INC="$(sh fetch-and-build.sh --includedir)"
JSC_LIB="$(sh fetch-and-build.sh --libdir)"
QJS_OBJ="$(sh ../vendored-qjs/build.sh --objdir)"
QJS_INC=../../js/swift/Sources/CQuickJS/include

# JavaScriptCore is C++ with two supporting archives (WTF, bmalloc) and a hard
# ICU dependency. --start-group because the three archives reference each other
# in both directions; a single ordered pass does not resolve them. quickjs-ng
# needs libm and libpthread and nothing else — that difference IS the finding
# this line makes concrete, and ADAPTER.md §5 costs it out for the watch.
JSC_LINK="-Wl,--start-group $JSC_LIB/libJavaScriptCore.a $JSC_LIB/libWTF.a $JSC_LIB/libbmalloc.a -Wl,--end-group -licui18n -licuuc -licudata -lstdc++ -latomic -lpthread -ldl -lm"
QJS_LINK="$QJS_OBJ/quickjs.o $QJS_OBJ/libregexp.o $QJS_OBJ/libunicode.o $QJS_OBJ/dtoa.o -lm -lpthread"

# shellcheck disable=SC2086  # the flag/link lists are deliberate word lists
$CC_BIN $CFLAGS -I"$JSC_INC" -o "$OUT/jsc-host" jsc-host.c $JSC_LINK
# shellcheck disable=SC2086
$CC_BIN $CFLAGS -I"$JSC_INC" -Wl,--gc-sections -o "$OUT/jsc-host-gc" jsc-host.c $JSC_LINK
# shellcheck disable=SC2086
$CC_BIN $CFLAGS -I"$QJS_INC" -o "$OUT/embed-host-qjsng" ../embed-smoke/embed-host.c $QJS_LINK
# shellcheck disable=SC2086
$CC_BIN $CFLAGS -I"$QJS_INC" -Wl,--gc-sections -o "$OUT/embed-host-qjsng-gc" ../embed-smoke/embed-host.c $QJS_LINK
# The PRODUCTION boot path, quickjs-ng only: the watch ships .qbc, not source.
# JSC has no C-API counterpart to compile against (README.md Stage 2), which is
# why this tool exists on one side of the table and not the other.
# shellcheck disable=SC2086
$CC_BIN $CFLAGS -I"$QJS_INC" -o "$OUT/qjs-compile" ../qjs-compile/qjs-compile.c $QJS_LINK

for b in jsc-host jsc-host-gc embed-host-qjsng embed-host-qjsng-gc; do
    cp "$OUT/$b" "$OUT/$b.stripped"
    strip "$OUT/$b.stripped"
done

echo "built $OUT/jsc-host and $OUT/embed-host-qjsng" >&2
{
    echo
    printf '%-34s %12s\n' "engine archive" "bytes"
    printf '%-34s %12s\n' "quickjs-ng (4 .o)" "$(cat "$QJS_OBJ"/*.o | wc -c)"
    printf '%-34s %12s\n' "jsc libJavaScriptCore.a" "$(wc -c <"$JSC_LIB/libJavaScriptCore.a")"
    printf '%-34s %12s\n' "jsc libWTF.a" "$(wc -c <"$JSC_LIB/libWTF.a")"
    printf '%-34s %12s\n' "jsc libbmalloc.a" "$(wc -c <"$JSC_LIB/libbmalloc.a")"
    echo
    printf '%-34s %12s\n' "linked host, stripped" "bytes"
    printf '%-34s %12s\n' "quickjs-ng embed-host" "$(wc -c <"$OUT/embed-host-qjsng.stripped")"
    printf '%-34s %12s\n' "quickjs-ng embed-host --gc-sections" "$(wc -c <"$OUT/embed-host-qjsng-gc.stripped")"
    printf '%-34s %12s\n' "jsc jsc-host" "$(wc -c <"$OUT/jsc-host.stripped")"
    printf '%-34s %12s\n' "jsc jsc-host --gc-sections" "$(wc -c <"$OUT/jsc-host-gc.stripped")"
} >&2
