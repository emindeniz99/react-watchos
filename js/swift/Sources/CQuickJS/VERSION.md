# Vendored: quickjs-ng v0.16.2

Source: https://github.com/quickjs-ng/quickjs/archive/refs/tags/v0.16.2.tar.gz
License: MIT (see LICENSE in this directory)

Core engine files only — `quickjs-libc` (the OS interface) is deliberately
excluded; the app's only I/O is the `__host` bridge installed by
JSRuntime.swift. `quickjs-swift-shim.h` is ours (wraps macros Swift can't
import) and is the watch target's bridging header.

Compiled sources are exactly the upstream `qjs_sources` set from CMakeLists:
`quickjs.c libregexp.c libunicode.c dtoa.c`. As of v0.15.x upstream split the
number<->string conversion out into `dtoa.c` and made `cutils` header-only, so
`cutils.c`/`xsum.c` (vendored through v0.10.1) are no longer compiled.

Verified on Linux via `tools/embed-smoke/run.sh`, which compiles these
exact files and runs the production React bundle through the same C API
sequence JSRuntime.swift uses.

## Updating to a new release

Run `tools/vendor-quickjs/run.sh <tag>` (e.g. `v0.16.0`). It downloads the
upstream tarball, overwrites the four `qjs_sources` files, refreshes the
headers we vendor (leaving our `quickjs-swift-shim.h` alone) and the LICENSE,
and bumps the version line + source URL above. Then review the prose in this
file, bump the version in `js/swift/README.md`, and run
`tools/embed-smoke/run.sh` to prove the new engine still embeds.

Tarball SHA-256: 97c80625b26775a4c7ca618c004d4ea24cf99cbf867e4eba78bd927a8b23d106
(recorded 2026-07-04; verified by re-downloading the tagged tarball — future
re-vendors verify BEFORE extraction via tools/vendor-quickjs/run.sh)
