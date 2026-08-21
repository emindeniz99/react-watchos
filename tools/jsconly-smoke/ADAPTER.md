# If we DID swap the engine: what the JSC seam would cost

Design sketch, written after the Stage 1–3 measurements in
[`README.md`](./README.md). It exists so the "how hard would it be?" half of the
question has an answer even though the verdict is *don't*, and so that a future
engine evaluation inherits a map of where this project is actually coupled to
quickjs-ng instead of rediscovering it.

Read `README.md` first for what was measured. This file assumes those results.

It deliberately mirrors the section order of
`experiment/primjs-engine`'s `ADAPTER.md`, so the two engines can be compared
paragraph for paragraph. Where the two experiments disagree — and on arm64_32
they disagree completely — that is called out.

---

## 1. Where the engine is bolted in

Three places, and only three. Unchanged from the PrimJS analysis, because it is
a property of *this* repo rather than of the candidate engine.

| Layer | File | Coupling |
| --- | --- | --- |
| SwiftPM target | `js/swift/Package.swift` — `.target(name: "CQuickJS")` | Vendored C sources compiled by SwiftPM; `ReactWatchRuntime` depends on it |
| Module surface | `js/swift/Sources/CQuickJS/include/module.modulemap` | Exposes `quickjs.h` + `quickjs-swift-shim.h` as the `CQuickJS` Clang module |
| The embedding | `js/swift/Sources/ReactWatchRuntime/JSRuntime.swift` (971 lines) | ~90 `JS_*` call sites across 30 distinct entry points |

Everything above `JSRuntime` — the SwiftUI interpreter, the widget runtime, the
wire models — talks to `JSRuntime`'s Swift API, not to the engine.

**But the PrimJS conclusion does not carry over.** There, the seam was
tractable because a ~90-line header could rename `JS_*` → `LEPUS_*` and this
repo's four C hosts compiled **unmodified**. JSC shares no vocabulary with
QuickJS:

| | quickjs-ng | JSC C API |
| --- | --- | --- |
| value | `JSValue`, refcounted, `JS_FreeValue` at every site | `JSValueRef`, GC-managed, `JSValueProtect`/`Unprotect` only when held across calls |
| exception | a sentinel value, `JS_IsException(v)` | an out-parameter `JSValueRef* exception`, `NULL` return |
| string | `const char*` via `JS_ToCString` (engine's own bytes for ASCII) | `JSStringRef`, UTF-16, explicit `JSStringRelease`, transcode on every crossing |
| property | `JS_GetPropertyStr(ctx, obj, "x")` | make a `JSStringRef`, `JSObjectGetProperty`, release it |
| native fn | `JS_NewCFunction(ctx, fn, "n", argc)` | `JSObjectMakeFunctionWithCallback(ctx, nameRef, cb)`, different callback signature |
| microtasks | `JS_ExecutePendingJob` loop, embedder-driven | automatic on `JSLock` release |

`jsc-host.c` in this directory is what that costs in practice: ~300 lines of
new C to reach the same assertions, with no line shared with
`tools/embed-smoke/embed-host.c`. **There is no compat header to write, so
"Option A" from the PrimJS sketch — vend the same header spelling from a second
SwiftPM target — is not available.** Only a real shim wall (that sketch's
"Option B") works for JSC, i.e. an `RWEngine_*` C API implemented twice with
`JSRuntime.swift` calling only that. That is a design, not a rename, and §3
says the interesting work is not in the seam anyway.

`quickjs-swift-shim.h` — the seven `static inline` functions that exist because
Swift cannot import C macros — is the one piece that survives: JSC's C API is
functions all the way down, so the Swift side would need *fewer* shims, not
more.

## 2. The watchOS availability question — settled

**This is the part a Mac cannot rescue either way, and it can be settled from
here.**

`JavaScriptCore.framework` is **not in the watchOS SDK**. Apple's own
documentation index is unambiguous — the framework page's platform list
(`developer.apple.com/tutorials/data/documentation/javascriptcore.json`) reads:

```
iOS 16.0   iPadOS 16.0   Mac Catalyst 13.0   macOS 10.5   tvOS 9.0   visionOS 1.0
```

No watchOS. Every symbol page repeats the same six platforms:

| symbol | platforms |
| --- | --- |
| `JSContext` | iOS 7.0, iPadOS 7.0, Mac Catalyst 13.1, macOS 10.9, tvOS 9.0, visionOS 1.0 |
| `JSValue` | same six |
| `JSVirtualMachine` | same six |
| `JSScript` (the bytecode-cache class) | **no documentation page at all**; WebKit's own header annotates it `JSC_CLASS_AVAILABLE(macos(10.15), ios(13.0))` |

Corroboration, and the one result that could be misread: WebKit bug
[#212788](https://bugs.webkit.org/show_bug.cgi?id=212788), "JavaScriptCore:
Support tvOS and watchOS builds with the public SDK" (Jonathan Bedard,
RESOLVED FIXED, r262808, June 2020). That is about **WebKit's own tree**
building for those platforms against framework stubs — it is a WebKit-developer
capability, not an app-developer one. It does not put a JSC in the SDK, and the
Apple documentation above is what an app can actually link.

**Consequence:** on watchOS there is no system-framework option at all. The
only route is the one measured in `README.md` — statically linking a self-built
JSC — which is where the 13.1× binary and the 16.2 MB resident floor come from.
The roadmap's original premise was correct.

Sources:
- <https://developer.apple.com/documentation/javascriptcore> (platform list; the
  `tutorials/data/…json` form is the machine-readable one this was read from)
- <https://bugs.webkit.org/show_bug.cgi?id=212788>

## 3. What `JSRuntime` touches that JSC would change

The rename is not the work. These are:

| `JSRuntime.swift` uses | JSC | Consequence |
| --- | --- | --- |
| `JS_ReadObject` + `JS_EvalFunction` (`evaluateBytecode`, the **shipped** boot path) and `JS_WriteObject(…, STRIP_SOURCE)` (the OTA compile path) | **no bytecode API at any C level** | `JSScriptRefPrivate.h` offers `JSScriptCreateFromString`/`JSScriptEvaluate` and no writer. `JSC::serializeBytecode`, `CachedBytecode`, `BytecodeCacheError` are C++ `JS_EXPORT_PRIVATE`. The only shipped cache is the **Objective-C** `JSScript` `…andBytecodeCache:` — `macos(10.15), ios(13.0)`, undocumented, keyed by `computeJSCBytecodeCacheVersion()` so it self-invalidates on any engine change, and the header hands the staleness problem back to the caller ("if the cached bytecode at this location is stale, you should delete that file"). **This deletes `tools/qjs-compile`, the `.qbc` OTA artifact, and `js/test/qbc-symbolication.test.ts`'s subject**, and costs the 5.5 ms → 36.1 ms boot in `README.md`. |
| `JS_ComputeMemoryUsage(rt, &usage).memory_used_size` | `JSGetMemoryUsageStatistics(ctx)`, **in `JSBasePrivate.h`** | The number exists and is good — `heapSize`, `heapCapacity`, `objectCount`, and it does not lie (1.5 MB, unchanged after a forced GC). But it is a **private** header. `tools/embed-smoke/run.sh`'s 6 MB budget gate is built on a *public* API precisely so it is portable; rebasing it on SPI is a different kind of dependency. Building our own engine makes this a non-issue in practice and a problem in principle. |
| `JS_SetMemoryLimit(rt, memoryLimitBytes)` — the widget's cap | **no per-runtime equivalent** | `JSC::Options::gcMaxHeapSize` / `forceRAMSize` are **process-global** options, set in C++ or through a `JSC_gcMaxHeapSize` environment variable (`Options.cpp:1059` reads the `JSC_` prefix). One process cannot give the widget runtime and the app runtime different budgets. Redesign, not port. |
| `JS_SetHostPromiseRejectionTracker(rt, cb, nil)` | **not in the C API** | The hook is `GlobalObjectMethodTable::promiseRejectionTracker` — a C++ vtable entry on a custom `JSGlobalObject` subclass. Same *shape* as ours (push, with an operation enum covering "rejected" and "handled after the fact", so `pendingRejections` retraction still works) — but reaching it means a C++ global object class, which means the `CQuickJS`-shaped pure-C target becomes a C++ target. |
| `JS_UpdateStackTop(runtime)` — 3 sites, the ARCH-08 mechanism | **automatic** | `JSLock.cpp:137` calls `VM::setStackPointerAtVMEntry` on every lock acquisition, which calls `VM::updateStackLimits()`, which re-reads `Thread::currentSingleton().stack()`. Cross-thread entries from the WidgetKit pool re-anchor themselves. **This one is a straight win**, and the opposite of PrimJS, which had no equivalent at all. |
| `JS_ExecutePendingJob` drain loop — 4 sites | **automatic** | `JSLock.cpp:198` drains microtasks on lock release. The pump becomes dead code. Also a win. |
| `Error.stack` parsing (`js/scripts/symbolicate-core.ts`, and the diagnostics path in `JSRuntime`) | **different string format** | `f@file:1:2` vs `at f (file:1:2)`. `STACK_FRAME_RE` matches only the parenthesised form and its comment says the looser pattern was rejected on purpose. A port adds a second pattern in the symbolicator and in the Swift diagnostics reader. The *positions* are good (line and column, right lines), but `qbc-symbolication.test.ts`'s `expect(position?.name).toBe("detail")` fails on JSC's column choice — see `README.md`. |
| `JS_Eval(…, COMPILE_ONLY)` then `JS_EvalFunction` — the two-phase `evaluate` | **no compile-without-run** | `JSCheckScriptSyntax` parses and discards; there is nothing to hand back. `JSRuntime.evaluate`'s split (which exists so a budget raise shows which half grew) collapses into one call. |
| `JS_GetVersion()` — the "which engine wrote this bytecode" stamp in `VERSION.md` | n/a | There is no bytecode to stamp. |

Plus two that are not APIs at all:

- **JSC is C++**, so `ReactWatchRuntime` links `libc++` and the `CQuickJS`-shaped
  SwiftPM target becomes a C++ target — the same line item PrimJS had, with the
  same mitigation (libc++ ships with the OS, so ~0 binary cost) and the same
  real decision about Swift ↔ C++ interop versus keeping a pure-C wall.
- **ICU becomes a dependency.** See §6.

## 4. The arm64_32 question — WebKit gets this right

**The PrimJS experiment found arm64_32 to be a hard blocker. For JSC the
opposite is true, and it is provable from Linux.**

Apple Watch Series 4 and later run **arm64_32**: the AArch64 instruction set
with **ILP32** — 32-bit pointers. Compiler-verified on this machine:

```
$ echo | clang -target arm64_32-apple-watchos8.0 -dM -E -x c - \
    | grep -E '__aarch64__|__SIZEOF_POINTER__|__ILP32__'
#define __ILP32__ 1
#define __SIZEOF_POINTER__ 4
#define __aarch64__ 1
```

WebKit selects its address model from the **pointer width**, not the
instruction set (`Source/WTF/wtf/PlatformCPU.h:306`):

```c
/* __LP64__ is not defined on 64bit Windows since it uses LLP64.
   Using __SIZEOF_POINTER__ is simpler. */
#if __SIZEOF_POINTER__ == 8
#define WTF_CPU_ADDRESS64 1
#elif __SIZEOF_POINTER__ == 4
#define WTF_CPU_ADDRESS32 1
```

…and then keeps 64-bit *registers* separately:

```c
#if CPU(ADDRESS64) || CPU(ARM64)
#define WTF_CPU_REGISTER64 1
```

…which is what picks the value representation (`PlatformUse.h:130`):

```c
#if CPU(REGISTER64)
#define USE_JSVALUE64 1
```

So on arm64_32 WebKit lands on `CPU(ADDRESS32)` + `CPU(REGISTER64)` +
`USE(JSVALUE64)` — 64-bit registers, 32-bit pointers, which **is** the arm64_32
model. Compare PrimJS, which keys the same decision on `defined(__aarch64__)`
and would assert 64-bit pointers on a 4-byte-pointer target.

The tree knows the platform by name, not by accident:

- `OS(WATCHOS)` (`PlatformOS.h:80`) and `PLATFORM(WATCHOS)`
  (`PlatformLegacy.h:90`, from `TARGET_OS_WATCH`) are first-class, and are used
  in live code — `runtime/StructureID.h:44` picks a different structure-ID
  encoding for watchOS, `runtime/Options.cpp:1528` gates a WebAssembly option
  on `!PLATFORM(WATCHOS)`.
- `interpreter/CallFrame.h:107` carries an explicit
  `// arm64_32 expects caller frame and return pc to use 8 bytes`.
- `offlineasm/backends.rb:79` maps the `ARM64_32` backend name.
- `PlatformHave.h:194`: *"watchOS (ARM64_32) must not use int128_t because of
  wrong behavior."*

**Verdict on the architecture: not a blocker.** The CLoop's whole selling point
— a portable C++ interpreter with no hand-written assembly — holds, and the
build we measured contains no assembler at all (`README.md` Stage 1). What kills
this experiment is size and footprint, not portability. That is worth stating
plainly, because it is the opposite of the PrimJS result and a future reader
should not carry the wrong lesson across.

**What still needs a Mac** (i.e. what this experiment genuinely could not
answer):

1. The real arm64_32 binary delta. §5's Linux x86_64 number is a proxy; 32-bit
   pointers shrink data structures and AArch64 code density differs from x86_64,
   so the true figure could plausibly be 20–30% either side of 14 MB. It will
   not be 1 MB.
2. Whether the 16.2 MB resident floor survives a 4-byte-pointer build. Some of
   it is the mapped binary and some is bmalloc's reservations; splitting them
   needs Instruments, and the widget's 16 MB cap makes the answer decisive
   rather than academic.
3. Whether `libicucore.dylib` can be linked at all under App Review (§6).

## 5. Binary size and footprint, stated as a proxy

Measured on Linux x86_64, `clang -O2` hosts, engines at their own projects'
flags (quickjs-ng `-O2`, JSC `-O3` via WebKit's Release configuration).
**This is a proxy, not a watchOS number** — different architecture, different
pointer width, and ICU resolved dynamically rather than counted.

| | quickjs-ng | jsc jitless | Δ |
| --- | --- | --- | --- |
| engine objects | 1,416,400 B (4 `.o`) | 42,792,648 B (543 `.o`) | +2,922% |
| linked host, stripped | 1,092,464 B | 16,706,016 B | **15.3×** |
| linked host, stripped, `--gc-sections` | 1,092,464 B | 14,346,720 B | **13.1×** |
| `.text` | 1,057,682 B | 13,981,531 B | 13.2× |
| **RSS, empty script** | **3,020 KB** | **16,164 KB** | **5.4×** |
| RSS, after booting the bundle | 5,716 KB | 25,384 KB | 4.4× |

Read the **linked, `--gc-sections`, stripped** row: WebKit compiles with
`-ffunction-sections -fdata-sections`, so a linker told to garbage-collect
sections drops what the embedding never calls, and Apple's linker dead-strips
at function granularity by default through its atom model. That row is the
closest analogue of an app link. quickjs-ng is compiled without those flags
(plain `-O2` in `tools/vendored-qjs/build.sh`) and is unchanged by
`--gc-sections`, which is why both rows are printed rather than one.

The RSS rows are the ones that decide the row, not the size rows.
`tools/embed-smoke/run.sh` records that the widget runs the engine **under a
16 MB cap**; JSC's *empty-context* floor is 16.2 MB. A WidgetKit extension
would be over budget before evaluating a single line of the app.

## 6. ICU — the dependency that is in none of the numbers

There is no `ENABLE_INTL` switch in `WebKitFeatures.cmake`.
`OptionsJSCOnly.cmake` does `find_package(ICU 70.1 REQUIRED COMPONENTS data
i18n uc)`, unconditionally. JSC needs ICU for `Intl`, collation, normalization
and case mapping, and there is no supported way to build it out.

On this machine ICU is a system shared library, so **it appears in none of §5's
figures**:

| | bytes |
| --- | --- |
| `libicudata.so.74.2` | 30,795,392 |
| `libicui18n.so.74.2` | 3,455,304 |
| `libicuuc.so.74.2` | 2,140,336 |

Three ways this could go on watchOS, none of them free:

1. **Link `libicucore.dylib`** — present on every Apple OS including watchOS,
   in the dyld shared cache, so it costs the app no bytes. It is what Apple's
   own JSC links. It is also **not a public library**: no headers in the SDK, no
   documented symbols, and App Review has historically rejected direct linkage.
2. **Build ICU into the app.** ICU's data can be filtered down hard, but the
   floor for what JSC calls is not small, and it lands on top of 14 MB.
3. **Patch ICU out of JSC.** Not supported upstream, and it is exactly the kind
   of per-bump patching the roadmap row already flagged as the maintenance cost.

quickjs-ng's answer to the same problem is `libunicode.c` — ~250 KB, already
inside the 1,416,400 B archive, with `Intl` simply absent. That absence is why
this project has `plurals-cldr` in its dependencies, which is the honest
comparison: **JSC's one language-conformance win over quickjs-ng costs a
36 MB dependency, and quickjs-ng's answer to the same gap costs 2.7 KB.**

## 7. Licensing, as facts

WebKit is a BSD/LGPL mix, and both halves are present in what a JSCOnly build
links.

| | LGPL-headered files | total `.cpp`/`.h` |
| --- | --- | --- |
| `Source/JavaScriptCore` | **185** | 3,223 |
| `Source/WTF` | **91** | 952 |

The LGPL files are the KJS/KDE lineage and they are not peripheral —
`parser/Parser.cpp`, `parser/Lexer.cpp`, `parser/Nodes.cpp`,
`runtime/Identifier.cpp`, `runtime/JSCell.cpp`, `runtime/Lookup.h` are among
them. Their headers read "GNU Library General Public License … either version 2
of the License, or (at your option) any later version", with
`JavaScriptCore/COPYING.LIB` carrying the text. Everything else is
BSD-2-Clause under Apple copyright.

For contrast: this package is MIT (`LICENSE`), and its vendored engine is MIT
(`NOTICE`: *"quickjs-ng … Licensed under the MIT licence"*).

Statically linking LGPL code into a distributed binary engages LGPL §6, which
is about the recipient's ability to relink the work with a modified version of
the library. That is a real obligation with known mechanisms (shipping object
files, or dynamic linking), and it is one this project does not have today. It
would need an answer **before** shipping, not after. Facts only — this is not
legal advice, and nobody should treat it as such.

## 8. Vendor-bot implication

`tools/vendor-quickjs/run.sh` + `.github/workflows/vendor-quickjs.yml` +
`engine-attest.yml` are built around quickjs-ng's release shape. JSC changes
some of those assumptions and, unusually, *improves* one:

| The bot assumes | quickjs-ng | JSCOnly |
| --- | --- | --- |
| A source **tarball** per release to download and hash | `archive/refs/tags/vX.Y.Z.tar.gz` | **yes** — `webkitgtk.org/releases/webkitgtk-X.Y.Z.tar.xz`, versioned and stable |
| A **SHA-256 confirmable through a second channel** (M9) | published digest | **better than quickjs-ng**: webkitgtk publishes `.tar.xz.sums` (md5/sha1/sha256) *and* a detached `.tar.xz.asc` signature |
| A stable set of compiled sources to overwrite (`quickjs.c libregexp.c libunicode.c dtoa.c`) | 4 files | **~3,200 files across JavaScriptCore + WTF + bmalloc**, selected by CMake and generated in part by Ruby/Perl/Python at build time. The "vendor the sources SwiftPM compiles" model does not survive: SwiftPM cannot run offlineasm. |
| Releases are engine releases | every tag is | mostly — but the even/odd stable/development split has to be encoded, and `js/scripts/pick-quickjs-release.ts`'s soak policy would need it |
| `js/test/vendor-integrity.test.ts` pins a per-file `CHECKSUMS.sha256` | 4 files + curated headers | one tarball digest instead, which is *simpler*, but attests a 63 MB blob rather than 4 reviewable files |

The blocker is the third row, and it is not a bot problem: **a self-built JSC
cannot be a SwiftPM source target at all.** The build needs CMake, Ninja, Ruby
(offlineasm), Perl, Python, gperf, bison and flex before it produces a library.
The only shippable shape is a **prebuilt `.xcframework`** built on a Mac and
committed or released as a binary target — which trades the vendor bot's
reviewable-source story for a binary blob, and adds an arm64_32 + arm64
watchOS-simulator build matrix that only a Mac can produce.

That, rather than any single measurement, is what "adopting JSC" would actually
mean day to day.
