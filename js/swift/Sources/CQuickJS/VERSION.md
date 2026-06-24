# Vendored: quickjs-ng v0.15.1

Source: https://github.com/quickjs-ng/quickjs/archive/refs/tags/v0.15.1.tar.gz
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
