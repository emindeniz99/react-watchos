#!/bin/sh
# EXPERIMENT (see README.md) — builds this repo's THREE existing C hosts twice:
# once against the vendored quickjs-ng (the baseline every gate uses) and once
# against PrimJS, so the two can be measured on the same machine with the same
# inputs. Both copies land in ./out/, which is gitignored; nothing here touches
# the binaries tools/embed-smoke/run.sh and tools/qjs-compile/run.sh build.
#
# The hosts are compiled from their ORIGINAL sources, unedited — that is the
# whole point of the exercise. The only thing standing between
# tools/embed-smoke/embed-host.c and PrimJS is ./compat/quickjs.h, put ahead of
# PrimJS's include directory on the search path; read that file for what the
# bridge costs.
#
# Both sides are built with the SAME compiler at the SAME -O level (clang -O2)
# so the host code is not a variable. The ENGINES are each built with their own
# project's flags — quickjs-ng at -O2 via tools/vendored-qjs/build.sh, PrimJS at
# -Os -O3 via its own CMakeLists — because "the engine as its maintainers ship
# it" is the thing under comparison. That asymmetry is stated in README.md
# rather than papered over.
set -eu

cd "$(dirname "$0")"
OUT=out
mkdir -p "$OUT"

CC_BIN="${PRIMJS_HOST_CC:-clang}"
CFLAGS="-O2 -std=gnu11 -DNDEBUG"

PRIMJS_INC="$(sh fetch-and-build.sh --includedir)"
PRIMJS_LIB="$(sh fetch-and-build.sh --libdir)"
QJS_OBJ="$(sh ../vendored-qjs/build.sh --objdir)"
QJS_INC=../../js/swift/Sources/CQuickJS/include

# PrimJS is C++ (every engine source is a .cc), so a C host linking it needs the
# C++ runtime. quickjs-ng is C and needs nothing beyond libm/libpthread. This is
# itself a portability line item: on watchOS it would pull libc++ into the app.
PRIMJS_LINK="$PRIMJS_LIB/libquick.a -lstdc++ -lm -lpthread"
QJS_LINK="$QJS_OBJ/quickjs.o $QJS_OBJ/libregexp.o $QJS_OBJ/libunicode.o $QJS_OBJ/dtoa.o -lm -lpthread"

build_pair() {
    src="$1"
    name="$2"
    # -DPRIMJS marks the PrimJS side for heap-probe.c, the one file here that
    # deliberately reaches past the compat layer to a LEPUS_* call with no
    # quickjs-ng counterpart. The four REAL hosts never see it — they must not
    # be able to tell which engine they were linked against.
    # shellcheck disable=SC2086  # the flag/link lists are deliberate word lists
    "$CC_BIN" $CFLAGS -DPRIMJS -Icompat -I"$PRIMJS_INC" -o "$OUT/$name-primjs" "$src" $PRIMJS_LINK
    # shellcheck disable=SC2086
    "$CC_BIN" $CFLAGS -I"$QJS_INC" -o "$OUT/$name-qjsng" "$src" $QJS_LINK
    echo "built $OUT/$name-primjs and $OUT/$name-qjsng" >&2
}

# The four unmodified repo hosts…
build_pair ../embed-smoke/embed-host.c embed-host
build_pair ../qjs-compile/qjs-compile.c qjs-compile
build_pair ../qjs-compile/qbc-stack.c qbc-stack
build_pair ../vendored-qjs/main.c qjs
# …and the one probe written FOR this experiment (see its header).
build_pair heap-probe.c heap-probe

echo "primjs static lib: $(wc -c <"$PRIMJS_LIB/libquick.a") B" >&2
