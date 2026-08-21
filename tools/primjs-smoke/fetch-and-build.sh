#!/bin/sh
# EXPERIMENT (see README.md in this directory) — builds Lynx's PrimJS engine so
# this repo's C hosts can be linked against it and measured beside the vendored
# quickjs-ng. Nothing here is part of the shipped product: quickjs-ng remains
# the one engine the watch runs, and `tools/vendored-qjs/build.sh` remains the
# baseline every gate uses.
#
# Deliberately NOT vendored into the repo. tools/vendored-qjs builds sources we
# already carry (js/swift/Sources/CQuickJS) because the watch compiles those
# same files; PrimJS is an outside engine under evaluation, so it is FETCHED at
# a pinned commit instead — vendoring ~18 MB of a third engine to answer a
# feasibility question would be a permanent cost for a temporary experiment.
#
# Output (mirrors tools/vendored-qjs/build.sh's conventions):
#   <cache>/src/        the shallow clone, pinned
#   <cache>/build/      the CMake/ninja build tree
#   <cache>/lib/libquick.a   the engine, static
#   <cache>/include/    the public headers (quickjs.h + its two includes)
#   <cache>/.stamp      hash over every input, so a warm run is free
#
# Usage:
#   fetch-and-build.sh              -> ensure built; print the cache root
#   fetch-and-build.sh --libdir     -> ensure built; print the lib directory
#   fetch-and-build.sh --includedir -> ensure built; print the include directory
#   fetch-and-build.sh --srcdir     -> ensure built; print the clone directory
#
# Diagnostics go to stderr so the printed path stays clean, same as the
# vendored-qjs script.
set -eu

cd "$(dirname "$0")"

# PINNED. Tag 4.0.0 — the newest release tag at the time this experiment ran
# (commit dated 2026-07-16), chosen over main HEAD so a re-run measures the same
# engine. A tag rather than a moving branch for the same reason the vendor bot
# pins quickjs-ng: a benchmark whose subject can change under it is not a
# benchmark.
PRIMJS_REPO="https://github.com/lynx-family/primjs.git"
PRIMJS_REF="4.0.0"
PRIMJS_COMMIT="7296488c03ae9da9ad5573f604518aa7e6c0c436"

# PrimJS's CMakeLists.txt hard-codes clang-only flags into CMAKE_C/CXX_FLAGS
# (-faddrsig, -fno-sanitize=safe-stack). GCC rejects both outright, so the
# compiler is not a preference here — it is a requirement of their build. This
# is itself a portability finding: see README.md.
CC_BIN="${PRIMJS_CC:-clang}"
CXX_BIN="${PRIMJS_CXX:-clang++}"

if [ -n "${PRIMJS_BUILD_DIR:-}" ]; then
    OUT="$PRIMJS_BUILD_DIR"
else
    OUT="${XDG_CACHE_HOME:-${HOME:-${TMPDIR:-/tmp}}/.cache}/react-watchos/primjs"
fi
mkdir -p "$OUT"
# Absolute, always: the printed paths are consumed from other working
# directories (build-hosts.sh, the compat probes), so a relative
# PRIMJS_BUILD_DIR must not leak out as a relative path.
OUT="$(cd "$OUT" && pwd)"
SRC="$OUT/src"
BUILD="$OUT/build"
LIB="$OUT/lib"
INC="$OUT/include"
STAMP="$OUT/.stamp"

# Same stamp discipline as vendored-qjs: the machine (`uname -sm`) and the
# compiler identity are hashed in because the product is an ar archive of native
# objects — reusing an x86_64 build on arm64 is not stale, it is unrunnable.
# The pinned commit is in there so bumping PRIMJS_COMMIT rebuilds exactly once.
stamp() {
    {
        printf '%s\n%s\n' "$PRIMJS_COMMIT" "$PRIMJS_REF"
        cat fetch-and-build.sh
        uname -sm
        "$CXX_BIN" --version
    } | sha256sum | cut -d' ' -f1
}

WANT="$(stamp)"
if [ ! -f "$LIB/libquick.a" ] || [ ! -f "$STAMP" ] || [ "$(cat "$STAMP")" != "$WANT" ]; then
    # Drop the stamp BEFORE touching anything: a build killed halfway would
    # otherwise leave the old stamp beside a half-written archive and the next
    # run would call that up to date. Absent stamp = rebuild.
    rm -f "$STAMP"

    if ! command -v "$CXX_BIN" >/dev/null 2>&1; then
        echo "primjs: $CXX_BIN not found — PrimJS's CMake flags require clang" >&2
        exit 1
    fi
    if ! command -v cmake >/dev/null 2>&1 || ! command -v ninja >/dev/null 2>&1; then
        echo "primjs: cmake and ninja are required" >&2
        exit 1
    fi

    # Fetch exactly one commit. PrimJS's README documents a gn/ninja build that
    # first wants `source tools/envsetup.sh && hab sync .` — a bootstrap that
    # pulls a toolchain and extra deps. The CMake path in the repo root builds
    # the same `quickjs` target with nothing but cmake+ninja+clang, so that is
    # the least-ceremony route to "an engine library and its headers", which is
    # all this experiment needs. No `hab sync`, no gn, no depot_tools.
    if [ ! -d "$SRC/.git" ]; then
        echo "primjs: cloning $PRIMJS_REF ($PRIMJS_COMMIT) into $SRC" >&2
        rm -rf "$SRC"
        mkdir -p "$SRC"
        git -C "$SRC" init -q
        git -C "$SRC" remote add origin "$PRIMJS_REPO"
    fi
    if [ "$(git -C "$SRC" rev-parse HEAD 2>/dev/null || echo none)" != "$PRIMJS_COMMIT" ]; then
        git -C "$SRC" fetch -q --depth 1 origin "$PRIMJS_COMMIT"
        git -C "$SRC" checkout -q --detach FETCH_HEAD
    fi
    HAVE="$(git -C "$SRC" rev-parse HEAD)"
    if [ "$HAVE" != "$PRIMJS_COMMIT" ]; then
        echo "primjs: checked out $HAVE, expected $PRIMJS_COMMIT" >&2
        exit 1
    fi

    echo "primjs: building the 'quickjs' target with $CXX_BIN (~4 min, cached after this)" >&2
    # Only the `quickjs` target. CMakeLists also defines napi_static (and, under
    # ENABLE_UNITTESTS, qjs/run-test262); this experiment wants the engine and
    # nothing else — no Lynx runtime, no napi, no inspector, no WASM.
    # ENABLE_* options are all left OFF (their defaults), which is what keeps
    # the inspector/heap-profiler/debugger sources out of the archive.
    cmake -S "$SRC" -B "$BUILD" -G Ninja \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_C_COMPILER="$CC_BIN" \
        -DCMAKE_CXX_COMPILER="$CXX_BIN" >&2
    ninja -C "$BUILD" quickjs >&2

    # Stage lib + headers into a stable shape so callers never reach into the
    # CMake tree. quickjs.h pulls in exactly two project headers (base_export.h,
    # list.h); the rest of that directory is engine-internal.
    rm -rf "$LIB" "$INC"
    mkdir -p "$LIB" "$INC"
    cp "$BUILD/libquick.a" "$LIB/"
    for h in quickjs.h base_export.h list.h quickjs-tag.h cutils.h; do
        cp "$SRC/src/interpreter/quickjs/include/$h" "$INC/"
    done

    printf '%s' "$WANT" >"$STAMP"
else
    echo "primjs: up to date ($OUT)" >&2
fi

case "${1:-}" in
--libdir) printf '%s\n' "$LIB" ;;
--includedir) printf '%s\n' "$INC" ;;
--srcdir) printf '%s\n' "$SRC" ;;
*) printf '%s\n' "$OUT" ;;
esac
