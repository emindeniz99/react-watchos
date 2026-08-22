#!/bin/sh
# Tree-diff workload benchmark (docs/perf-tree-diff.md): runs the real demo
# bundles inside the VENDORED quickjs-ng via embed-host and measures the
# report's workloads through today's full-tree pipeline AND the patch
# prototype (treediff-proto.js). Manual/decision tooling — deliberately not
# a CI gate (bench.sh stays the recorded per-commit tripwire).
# Same rebuild rules as bench.sh: reuse embed-host unless the host or the
# vendored engine sources are newer than the binary.
set -e
cd "$(dirname "$0")"
VENDOR=../../js/swift/Sources/CQuickJS
BUNDLE=../../js/dist/bundle.js
WIDGET_BUNDLE=../../js/dist/widget.bundle.js
[ -f "$BUNDLE" ] || (cd ../.. && pnpm --filter react-watchos build)
OBJ=$(../vendored-qjs/build.sh --objdir)
if [ ! -x embed-host ] || [ embed-host -ot embed-host.c ] \
  || [ embed-host -ot "$OBJ/quickjs.o" ]; then
  cc -O2 -std=gnu11 -DNDEBUG -I"$VENDOR/include" -o embed-host \
    embed-host.c "$OBJ"/*.o -lm -lpthread
fi
# The prototype is a separate file so the vitest fixture generator evals the
# SAME implementation; embed-host takes one epilogue, so concatenate.
EPILOGUE="${TMPDIR:-/tmp}/bench-treediff-epilogue.$$.js"
trap 'rm -f "$EPILOGUE"' EXIT
cat treediff-proto.js bench-treediff.js > "$EPILOGUE"
echo "== app bundle workloads =="
./embed-host "$BUNDLE" "$EPILOGUE"
echo "== widget bundle publish =="
./embed-host "$WIDGET_BUNDLE" bench-treediff-widget.js
