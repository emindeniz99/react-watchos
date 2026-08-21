#!/bin/sh
# EXPERIMENT (see README.md in this directory) — builds WebKit's JSCOnly port
# with the JIT OFF (CLoop interpreter) so this repo's production bundle can be
# run inside JavaScriptCore and measured beside the vendored quickjs-ng.
# Nothing here is part of the shipped product: quickjs-ng remains the one engine
# the watch runs, and `tools/vendored-qjs/build.sh` remains the baseline every
# gate uses.
#
# Deliberately NOT vendored into the repo. tools/vendored-qjs builds sources we
# already carry (js/swift/Sources/CQuickJS) because the watch compiles those
# same files; JSC is an outside engine under evaluation, so it is FETCHED at a
# pinned release instead. The scale makes that non-negotiable: the tarball is
# 63 MB, it expands to 475 MB of source, and the build tree is another ~3 GB.
#
# WHY a webkitgtk release tarball and not a WebKit git checkout: webkitgtk.org
# ships versioned, signed, sha256-published source releases of the same WebKit
# tree, and that tree supports `-DPORT=JSCOnly` directly. A git clone of
# WebKit/WebKit is ~20 GB and has no release cadence to pin to. The GTK port is
# not built here — only JSCOnly, which pulls in JavaScriptCore + WTF + bmalloc
# and nothing graphical (no GTK, no Cairo, no GStreamer; ICU is the one external
# dependency).
#
# Output (mirrors tools/vendored-qjs/build.sh's conventions):
#   <cache>/webkitgtk-<v>.tar.xz  the pinned tarball, sha256-verified
#   <cache>/src/                  the expanded source
#   <cache>/build/                the CMake/ninja build tree
#   <cache>/lib/                  libJavaScriptCore.a, libWTF.a, libbmalloc.a
#   <cache>/include/              the public C API headers + JSBasePrivate.h
#   <cache>/bin/jsc               the JSC shell, for the .js probes
#   <cache>/.stamp                hash over every input, so a warm run is free
#
# Usage:
#   fetch-and-build.sh              -> ensure built; print the cache root
#   fetch-and-build.sh --libdir     -> ensure built; print the lib directory
#   fetch-and-build.sh --includedir -> ensure built; print the include directory
#   fetch-and-build.sh --jsc        -> ensure built; print the jsc shell path
#   fetch-and-build.sh --srcdir     -> ensure built; print the source directory
#
# Diagnostics go to stderr so the printed path stays clean, same as the
# vendored-qjs script.
set -eu

cd "$(dirname "$0")"

# PINNED. webkitgtk 2.52.6 — the newest STABLE release at the time this
# experiment ran (2026-08). webkitgtk's minor number follows the GNOME
# even/odd convention: 2.52.x is stable, 2.53.x is the development series, so
# 2.53.91 being "newer" is not a reason to take it. The sha256 is the one
# published beside the tarball at
# https://webkitgtk.org/releases/webkitgtk-2.52.6.tar.xz.sums — verified here
# for the same reason tools/vendor-quickjs pins a digest: a benchmark whose
# subject can change under it is not a benchmark, and an unverified 63 MB
# download is a supply-chain hole.
WEBKIT_VERSION="2.52.6"
WEBKIT_TARBALL="webkitgtk-${WEBKIT_VERSION}.tar.xz"
WEBKIT_URL="https://webkitgtk.org/releases/${WEBKIT_TARBALL}"
WEBKIT_SHA256="179a2ea3f8f6edd4be7f31fdc55afc57bd0729f1fba648c61d4181539ac116fc"

CC_BIN="${JSC_CC:-clang}"
CXX_BIN="${JSC_CXX:-clang++}"

if [ -n "${JSC_BUILD_DIR:-}" ]; then
    OUT="$JSC_BUILD_DIR"
else
    OUT="${XDG_CACHE_HOME:-${HOME:-${TMPDIR:-/tmp}}/.cache}/react-watchos/jsconly"
fi
mkdir -p "$OUT"
# Absolute, always: the printed paths are consumed from other working
# directories (build-hosts.sh, measure.sh), so a relative JSC_BUILD_DIR must
# not leak out as a relative path.
OUT="$(cd "$OUT" && pwd)"
SRC="$OUT/src"
BUILD="$OUT/build"
LIB="$OUT/lib"
INC="$OUT/include"
BIN="$OUT/bin"
STAMP="$OUT/.stamp"

# Same stamp discipline as vendored-qjs: the machine (`uname -sm`) and the
# compiler identity are hashed in because the product is a set of static
# archives of native objects — reusing an x86_64 build on arm64 is not stale,
# it is unrunnable. The pinned version is in there so bumping WEBKIT_VERSION
# rebuilds exactly once.
stamp() {
    {
        printf '%s\n%s\n' "$WEBKIT_VERSION" "$WEBKIT_SHA256"
        cat fetch-and-build.sh
        uname -sm
        "$CXX_BIN" --version
    } | sha256sum | cut -d' ' -f1
}

WANT="$(stamp)"
if [ -f "$LIB/libJavaScriptCore.a" ] && [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$WANT" ]; then
    echo "jsconly: up to date ($OUT)" >&2
else
    # Drop the stamp BEFORE touching anything: a build killed halfway would
    # otherwise leave the old stamp beside half-written archives and the next
    # run would call that up to date. Absent stamp = rebuild.
    rm -f "$STAMP"

    for tool in "$CXX_BIN" cmake ninja ruby perl python3 gperf bison flex; do
        if ! command -v "$tool" >/dev/null 2>&1; then
            echo "jsconly: $tool not found — WebKit's build needs it" >&2
            echo "jsconly: on Debian/Ubuntu: apt-get install -y cmake ninja-build ruby perl python3 gperf bison flex libicu-dev clang" >&2
            exit 1
        fi
    done

    if [ ! -f "$OUT/$WEBKIT_TARBALL" ]; then
        echo "jsconly: downloading $WEBKIT_URL (63 MB)" >&2
        curl -sSL --fail -o "$OUT/$WEBKIT_TARBALL.part" "$WEBKIT_URL"
        mv "$OUT/$WEBKIT_TARBALL.part" "$OUT/$WEBKIT_TARBALL"
    fi
    HAVE="$(sha256sum "$OUT/$WEBKIT_TARBALL" | cut -d' ' -f1)"
    if [ "$HAVE" != "$WEBKIT_SHA256" ]; then
        echo "jsconly: sha256 mismatch for $WEBKIT_TARBALL" >&2
        echo "  want $WEBKIT_SHA256" >&2
        echo "  have $HAVE" >&2
        exit 1
    fi

    if [ ! -f "$SRC/Source/JavaScriptCore/CMakeLists.txt" ]; then
        echo "jsconly: expanding $WEBKIT_TARBALL (475 MB of source)" >&2
        rm -rf "$SRC"
        mkdir -p "$SRC"
        tar -xf "$OUT/$WEBKIT_TARBALL" -C "$SRC" --strip-components=1
    fi

    # THE JITLESS CONFIGURATION. Option names verified against
    # src/Source/cmake/WebKitFeatures.cmake for THIS release rather than
    # remembered — they have churned (ENABLE_LLINT_C_LOOP became ENABLE_C_LOOP).
    #
    # ENABLE_C_LOOP is the master switch: it selects the portable C++ "CLoop"
    # interpreter that offlineasm emits instead of the LLInt's hand-written
    # assembly, and with it every JIT tier is unreachable. WebKit models the
    # incompatibilities as hard conflicts that FATAL_ERROR at configure time
    # (WebKitFeatures.cmake:266-269), so ENABLE_JIT / ENABLE_SAMPLING_PROFILER /
    # ENABLE_WEBASSEMBLY must be turned off EXPLICITLY — on x86_64 they all
    # default ON. DFG/FTL/BBQ/OMG would be auto-disabled by the DEPEND rules,
    # but they are named anyway so the intent survives a WebKit refactor.
    #
    # ENABLE_STATIC_JSC=ON is what makes the size question answerable at all:
    # without it JavaScriptCore is a .so and WTF/bmalloc collapse into it as
    # OBJECT libraries, and there is no archive to weigh.
    if [ ! -f "$BUILD/build.ninja" ]; then
        echo "jsconly: configuring JSCOnly, JIT off (CLoop)" >&2
        cmake -S "$SRC" -B "$BUILD" -G Ninja \
            -DPORT=JSCOnly \
            -DCMAKE_BUILD_TYPE=Release \
            -DCMAKE_C_COMPILER="$CC_BIN" \
            -DCMAKE_CXX_COMPILER="$CXX_BIN" \
            -DENABLE_STATIC_JSC=ON \
            -DENABLE_C_LOOP=ON \
            -DENABLE_JIT=OFF \
            -DENABLE_DFG_JIT=OFF \
            -DENABLE_FTL_JIT=OFF \
            -DENABLE_WEBASSEMBLY=OFF \
            -DENABLE_WEBASSEMBLY_BBQJIT=OFF \
            -DENABLE_WEBASSEMBLY_OMGJIT=OFF \
            -DENABLE_SAMPLING_PROFILER=OFF \
            -DENABLE_REMOTE_INSPECTOR=OFF >&2
    fi

    # Assert the flags actually landed. `-D` on a WebKit option is a request,
    # not a guarantee — the DEPEND/CONFLICT pass rewrites them — and a build
    # that silently kept the JIT would answer a different question than the one
    # asked. cmakeconfig.h is what the compiler sees.
    for want in "ENABLE_C_LOOP 1" "ENABLE_JIT 0" "ENABLE_DFG_JIT 0" \
        "ENABLE_FTL_JIT 0" "ENABLE_WEBASSEMBLY 0" "ENABLE_SAMPLING_PROFILER 0"; do
        if ! grep -qx "#define $want" "$BUILD/cmakeconfig.h"; then
            echo "jsconly: cmakeconfig.h does not say '#define $want' — the" >&2
            echo "         jitless configuration did not take. Refusing to" >&2
            echo "         measure a build that is not the one asked for." >&2
            exit 1
        fi
    done

    # Only the `jsc` target (which pulls JavaScriptCore, WTF and bmalloc).
    # OptionsJSCOnly.cmake force-sets ENABLE_API_TESTS ON with a plain set(),
    # so it cannot be turned off from the command line — building `all` would
    # add TestWebKitAPI and gtest for nothing. Naming the target is the fix.
    echo "jsconly: building (~500 translation units, tens of minutes cold)" >&2
    ninja -C "$BUILD" -j"$(nproc 2>/dev/null || echo 4)" jsc >&2

    # Stage lib + headers + shell into a stable shape so callers never reach
    # into the CMake tree.
    rm -rf "$LIB" "$INC" "$BIN"
    mkdir -p "$LIB" "$INC/JavaScriptCore" "$BIN"
    # WebKit's CMake writes THIN archives — `ar` indexes that hold absolute
    # paths to the objects rather than the objects themselves. Copying one
    # elsewhere produces a file that links only while the build tree survives,
    # and `wc -c` on it reports the size of an index (2.3 MB) rather than of an
    # engine (35 MB). Both matter here, so the archives are rebuilt as REAL
    # ones: self-contained, and weighable. This is also what an Xcode/SwiftPM
    # consumer would end up with.
    for lib in JavaScriptCore WTF bmalloc; do
        ar t "$BUILD/lib/lib$lib.a" | xargs ar qc "$LIB/lib$lib.a"
        ranlib "$LIB/lib$lib.a"
    done
    cp "$BUILD"/JavaScriptCore/Headers/JavaScriptCore/*.h "$INC/JavaScriptCore/"
    # JSBasePrivate.h is NOT part of the public C API — it is where
    # JSGetMemoryUsageStatistics lives, the only engine-side heap number JSC
    # exposes at the C level. Copied deliberately and separately so the README
    # can say exactly which one measurement costs a private header. See
    # ADAPTER.md §3.
    cp "$BUILD/JavaScriptCore/PrivateHeaders/JavaScriptCore/JSBasePrivate.h" "$INC/JavaScriptCore/"
    cp "$BUILD/bin/jsc" "$BIN/"

    printf '%s' "$WANT" >"$STAMP"
fi

case "${1:-}" in
--libdir) printf '%s\n' "$LIB" ;;
--includedir) printf '%s\n' "$INC" ;;
--jsc) printf '%s\n' "$BIN/jsc" ;;
--srcdir) printf '%s\n' "$SRC" ;;
--builddir) printf '%s\n' "$BUILD" ;;
*) printf '%s\n' "$OUT" ;;
esac
