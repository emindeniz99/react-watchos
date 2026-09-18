# Vendored: quickjs-ng v0.16.2
Upstream commit: 1ab8676f4b6d6d669baeb5f21790fb9734636a20

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

1. Resolve the tag to a commit from a machine that is not the one that will
   download: `sh tools/vendor-quickjs/resolve-tag.sh <tag>` (or the
   `git ls-remote --tags` line it wraps). The tag is a mutable pointer; the
   commit is what gets vendored.
2. Hash the archive at that commit:
   `curl -fsSL https://github.com/quickjs-ng/quickjs/archive/<commit>.tar.gz | shasum -a 256`
3. `tools/vendor-quickjs/run.sh <tag> <commit> <sha256>` — downloads by
   commit, verifies the digest, overwrites the four `qjs_sources` files,
   refreshes the headers we vendor (leaving our `quickjs-swift-shim.h` alone)
   and the LICENSE, and rewrites the version line, the commit line, the source
   URL and the digest below.
4. `sh tools/vendor-quickjs/verify-upstream.sh` — proves the tree is that
   commit's git objects and that upstream's tag still names it.
5. Review the prose in this file (`js/swift/README.md`'s table links here, so
   it needs no edit) and run `tools/embed-smoke/run.sh` to prove the new
   engine still embeds.

Tarball SHA-256: 97c80625b26775a4c7ca618c004d4ea24cf99cbf867e4eba78bd927a8b23d106
(the archive as downloaded on the bump day; in the bot it is the propose→push
handoff. GitHub does not promise archive bytes are stable, so a stale digest
is not evidence of tampering — the `Upstream commit:` line is the identity,
and verify-upstream.sh checks the tree and the tag binding against it)
