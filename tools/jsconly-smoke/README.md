# JSCOnly, jitless, self-built — an experiment, and its answer

> **Status: experiment. Nothing here ships, nothing here is wired into a gate,
> and quickjs-ng remains the one engine this project runs.** Everything in this
> directory is additive: it fetches WebKit at a pinned release into an
> out-of-repo cache, builds its JSCOnly port with the JIT off, links a JSC host
> beside this repo's *existing, unmodified* quickjs host, and measures the two
> side by side. `tools/vendored-qjs`, `tools/qjs-compile`, `tools/embed-smoke`,
> `js/swift/Sources/CQuickJS` and `docs/roadmap.md` are untouched.

**Question asked:** `docs/roadmap.md`'s engine-alternatives row declined
JavaScriptCore on the *system-framework* premise — "no public JSC on watchOS,
so you would build WebKit yourself, and a jitless JSC is megabytes against
quickjs-ng's ~1 MB". That was an estimate. This is the measurement.

**Answer: it runs the real production bundle correctly and it is the best
JavaScript engine here on language conformance — and it costs 13× the binary,
5× the resident floor, and 6.6× the cold start against the path this app
actually ships.** Recommendation at the bottom: **drop**, with one trigger.

Built from **webkitgtk 2.52.6** (sha256
`179a2ea3f8f6edd4be7f31fdc55afc57bd0729f1fba648c61d4181539ac116fc`), configured
`-DPORT=JSCOnly -DENABLE_C_LOOP=ON -DENABLE_JIT=OFF`, measured against vendored
**quickjs-ng** on one Linux x86_64 machine, 4 cores.

---

## The headline, in one table

Median of 21 runs, same machine, same 201,829 B minified `js/dist/bundle.js`,
same [`smoke-epilogue.js`](./smoke-epilogue.js), both hosts `clang -O2`.

| engine / input | parse ms | total ms | heap MB | peak RSS KB |
| --- | --- | --- | --- | --- |
| quickjs-ng   empty script | 0.0 | 0.0 | 0.1 | 3,020 |
| quickjs-ng   bundle source | 24.2 | 27.8 | 1.2 | 5,716 |
| **quickjs-ng   bundle `.qbc` — what ships** | 1.5 | **5.5** | 0.9 | **4,444** |
| jsc jitless  empty script | – | 0.2 | 0.0 | **16,164** |
| jsc jitless  bundle source | 6.7 | **36.1** | 1.5 | **25,384** |

| size | quickjs-ng | jsc jitless | ratio |
| --- | --- | --- | --- |
| engine objects | 1,416,400 B (4 `.o`) | 42,792,648 B (543 `.o`, 3 archives) | 30.2× |
| **linked host, stripped** | **1,092,464 B** | **16,706,016 B** | **15.3×** |
| linked host, stripped, `--gc-sections` | 1,092,464 B | 14,346,720 B | **13.1×** |
| `.text` only | 1,057,682 B | 13,981,531 B (gc) | 13.2× |
| ICU | none (own 250 KB `libunicode.c`) | **required**, linked dynamically here and counted in **none** of the above | — |

| behaviour | quickjs-ng | jsc jitless |
| --- | --- | --- |
| boots the real bundle, counter round-trips | yes | **yes** |
| `??` correct on `null` (the PrimJS disqualifier) | yes | **yes** |
| ES feature probe | 27/30 | **28/30** |
| stack frames carry line **and column** | yes | **yes** |
| stack frame *format* | `at f (file:1:2)` | `f@file:1:2` — needs a second pattern |
| symbolicates back to the `.tsx` | yes | yes, **but loses the name the gate asserts** |
| bytecode serialization from C | `JS_WriteObject` / `JS_ReadObject` | **none at any C level** |
| portable engine-side heap number | `JS_ComputeMemoryUsage`, **public API** | `JSGetMemoryUsageStatistics`, **private header (SPI)** |

The single number that decides it is not in any of those tables:
**`JavaScriptCore.framework` is not in the watchOS SDK** — verified against
Apple's own documentation index in [§ Stage 4](#stage-4--would-it-even-run-on-a-watch).
So this is not "link the system engine"; it is "ship 14 MB of WebKit inside a
watch app".

---

## Stage 1 — obtaining and building it

`sh fetch-and-build.sh` downloads one pinned tarball, verifies its published
sha256, expands it, configures JSCOnly with the JIT off, and builds the `jsc`
target into `~/.cache/react-watchos/jsconly/`. Nothing is vendored into the
repo (rationale in the script header — this is 475 MB of source).

**Source choice.** webkitgtk.org ships versioned, sha256-published source
releases of the same WebKit tree, and that tree supports `-DPORT=JSCOnly`
directly; a WebKit/WebKit git clone is ~20 GB and has no release cadence to pin
to. **2.52.6, not 2.53.x**: webkitgtk follows the GNOME even/odd convention, so
2.53 is the development series and "newer" is not "stable".

**The flags, and why the option names had to be researched rather than
remembered.** They have churned (`ENABLE_LLINT_C_LOOP` → `ENABLE_C_LOOP`), and
WebKit models the jitless combination as hard *conflicts* that
`FATAL_ERROR` at configure time rather than as things it will infer
(`Source/cmake/WebKitFeatures.cmake:266-269`):

```
-DPORT=JSCOnly -DCMAKE_BUILD_TYPE=Release -DENABLE_STATIC_JSC=ON
-DENABLE_C_LOOP=ON            # the master switch: the portable C++ interpreter
-DENABLE_JIT=OFF              # conflicts with C_LOOP -> must be explicit
-DENABLE_DFG_JIT=OFF -DENABLE_FTL_JIT=OFF
-DENABLE_WEBASSEMBLY=OFF      # conflicts with C_LOOP -> must be explicit
-DENABLE_WEBASSEMBLY_BBQJIT=OFF -DENABLE_WEBASSEMBLY_OMGJIT=OFF
-DENABLE_SAMPLING_PROFILER=OFF  # conflicts with C_LOOP -> must be explicit
-DENABLE_REMOTE_INSPECTOR=OFF
```

On x86_64 `ENABLE_JIT`, `ENABLE_WEBASSEMBLY` and `ENABLE_SAMPLING_PROFILER` all
default **ON**, so omitting any of the three fails the configure outright.
`fetch-and-build.sh` then **asserts the flags landed** by grepping the generated
`cmakeconfig.h` — `-D` on a WebKit option is a request that the DEPEND/CONFLICT
pass may rewrite, and a build that quietly kept the JIT would answer a
different question than the one asked.

**No executable memory is allocated, which is the property watchOS requires.**
Not by assertion: `ENABLE_YARR_JIT` is gated on `ENABLE(JIT)`
(`PlatformEnable.h:906`) so the regexp JIT is off too, and `ENABLE_ASSEMBLER` is
only force-enabled by `#if ENABLE(JIT) || ENABLE(YARR_JIT) || !ENABLE(C_LOOP)`
(`PlatformEnable.h:943`) — none of which hold. The build contains no assembler
at all.

**What it cost.**

| | |
| --- | --- |
| ninja edges | 2,644 |
| wall clock, `-j4` on 4 cores | **23 min** |
| of which `llint/LowLevelInterpreter.cpp` | **~9 min, single-threaded** |
| peak RAM, one clang | ~1.0 GB |
| disk: tarball / source / build tree / staged libs | 63 MB / 475 MB / 104 MB / 43 MB |

The CLoop is one enormous generated function, and at `-O3` it is a hard
serialization point: CMake's target-level dependency makes **all 183
JavaScriptCore translation units wait for it**, so for nine minutes a
four-core machine runs one compiler. Anyone budgeting CI time for a jitless JSC
should budget that single TU separately.

**Packages installed on top of a stock Ubuntu 24.04 image** (cmake, ninja,
ruby, perl, python3, bison and clang were already present):
`gperf`, `flex`, `libicu-dev` — which pulled in `icu-devtools`, `libfl2`,
`libfl-dev`. Nothing else.

**One staging subtlety worth recording.** WebKit's CMake writes **thin
archives**: `ar` indexes holding absolute paths, not objects. Copied out of the
build tree they link only while that tree survives, and `wc -c` on
`libJavaScriptCore.a` reports **2,266,398 B** — the size of an index, not of an
engine. `fetch-and-build.sh` re-archives them as real static libraries, which
is both what a SwiftPM/Xcode consumer would get and what makes the size row
above mean anything. The honest number is 37,422,460 B.

## Stage 2 — the API, and what a host has to become

[`jsc-host.c`](./jsc-host.c) is the JSC twin of
`tools/embed-smoke/embed-host.c`: same five `__host` methods, same bundle, same
assertions, ~300 lines.

**It is a rewrite, not a bridge — and that is the first structural finding.**
The PrimJS evaluation linked this repo's *unmodified* hosts behind a ~90-line
rename header, because PrimJS is a QuickJS fork. JSC shares no vocabulary with
QuickJS: different types, a different ownership model (GC-managed `JSValueRef`
with `JSValueProtect` against quickjs's refcounted `JSValue`), and exceptions
returned through an out-parameter rather than as a sentinel value. There is no
compat shim to write.

To keep the *comparison* honest anyway, the smoke assertions were lifted out of
`embed-host.c` into [`smoke-epilogue.js`](./smoke-epilogue.js) — byte-for-byte
the epilogue that host compiles in — and fed to **both** hosts through
`embed-host.c`'s existing optional-epilogue argument. One file, two engines.

**It boots.** Tree commits, navigation accepted, counter 0 → 1, identical JSON:

```
{"nav":{"handled":true,"accepted":true},"result":{"handled":true,"accepted":true},
 "initialCount":"Count: 0","countAfterPress":"Count: 1"}
```

### What JSC's C API gives us for free

| | |
| --- | --- |
| **Microtasks drain themselves** | `JSLock.cpp:198` — `drainMicrotasks()` on lock release, and every C API entry point takes and releases the lock. `JSRuntime.swift`'s explicit `JS_ExecutePendingJob` pump (4 sites) becomes dead code. |
| **The stack guard re-anchors itself** | `JSLock.cpp:137` → `VM::setStackPointerAtVMEntry` → `VM::updateStackLimits()`, which reads `Thread::currentSingleton().stack()`. That is exactly what `JS_UpdateStackTop` is called for at 3 sites in `JSRuntime.swift` (ARCH-08: handlers run on whichever pool thread services the queue). JSC does it per lock acquisition, automatically. |
| **`Intl`** | Present, because ICU is mandatory. quickjs-ng has none — which is why `plurals-cldr` is in this project's deps. |

### What it does not give us

| # | Gap | Severity | Detail |
| --- | --- | --- | --- |
| 1 | **No bytecode serialization at any C level** | **loses the shipping path** | `JSScriptRefPrivate.h` has `JSScriptCreateFromString` / `JSScriptEvaluate` and no writer. `JSC::serializeBytecode` / `CachedBytecode` are C++ `JS_EXPORT_PRIVATE`. The only public-ish caching is the **Objective-C** `JSScript` `…andBytecodeCache:` (`JSC_CLASS_AVAILABLE(macos(10.15), ios(13.0))` — no watchOS, no tvOS, and no page for it on developer.apple.com at all), keyed by `computeJSCBytecodeCacheVersion()` so it invalidates on any engine change. There is no `.qbc` equivalent. See the 5.5 ms → 36.1 ms row. |
| 2 | **No compile-without-run** | measurement + design | The closest is `JSCheckScriptSyntax`, which parses and discards. So the parse/eval split `embed-host.c` gets from `JS_EVAL_FLAG_COMPILE_ONLY` cannot be reproduced, and `JSRuntime.evaluate`'s two-phase shape has no counterpart. |
| 3 | **Heap accounting is SPI** | **loses a gate** | `JSGetMemoryUsageStatistics` lives in `JSBasePrivate.h`, not in `JavaScript.h`. `tools/embed-smoke/run.sh`'s 6 MB budget gate reads quickjs-ng's **public** `JS_ComputeMemoryUsage`. Porting the gate means depending on a private header — fine for our own build, not fine against a system framework. |
| 4 | **No per-runtime memory limit** | redesign | `JS_SetMemoryLimit(rt, …)` (used for the widget's cap) has no C API twin. `JSC::Options::gcMaxHeapSize` is a **process-global** option set in C++ or via a `JSC_gcMaxHeapSize` environment variable — it cannot give the widget runtime and the app runtime different budgets in one process. |
| 5 | **No promise-rejection hook in the C API** | redesign | The tracker is `GlobalObjectMethodTable::promiseRejectionTracker` — a C++ vtable entry on a custom `JSGlobalObject`. `JS_SetHostPromiseRejectionTracker` has no C-level equivalent, so `pendingRejections` would need a C++ subclass rather than a callback. |
| 6 | **Stack strings are spelled differently** | mechanical, but load-bearing | `f@file:1:2` vs `at f (file:1:2)`. `js/scripts/symbolicate-core.ts`'s `STACK_FRAME_RE` matches only the second form, deliberately (its comment rejects the looser pattern). See Stage 3. |
| 7 | **Strings are UTF-16 at the boundary** | small, constant | `JSStringCreateWithUTF8CString` transcodes the whole 201 KB bundle on the way in; `JSValueToStringCopy` transcodes back out. quickjs-ng hands back its own bytes for ASCII. |

## Stage 3 — running the real bundle

`sh measure.sh 21` produces the table at the top. Read it with three things in
mind, all of which are findings rather than caveats:

**1. The `parse` columns are not the same work.** quickjs-ng's 24.2 ms is a
complete parse of the program. JSC's 6.7 ms is `JSCheckScriptSyntax` in a
separate process — and JSC compiles function bodies **lazily**, so most of what
quickjs-ng does up front happens inside JSC's `total` instead. JSC's parser
really is fast; the number is just not the same quantity. **Compare `total`.**

**2. `total` against the path that ships is the number that matters.** The
watch boots `.qbc`, not source. **5.5 ms → 36.1 ms is 6.6×**, and it is not a
tuning gap — JSC has nowhere to put a precompiled artifact (gap 1). Even
source-to-source, JSC is 30% slower on this workload: a CLoop interpreter
against a purpose-built one, with no JIT to make up the difference. That is the
expected result and it is now measured rather than assumed.

**3. The resident floor, not the bundle, is what would kill this.** An **empty
script** in JSC costs **16.2 MB RSS** against quickjs-ng's 3.0 MB — before a
byte of app code. The full boot is 25.4 MB against 4.4 MB. `tools/embed-smoke/run.sh`'s
own comment records that *"the widget runs the same engine under a 16 MB cap"*.
**JSC's empty-context floor is that entire cap.** Nothing about a smaller bundle
or a leaner app changes it.

The GC heap itself is fine — 1.5 MB against 1.2 MB, and unchanged by a forced
`JSGarbageCollect`, so it is live data and not lazy garbage. JSC's problem here
is not its collector; it is the engine's own footprint.

**First-run noise, recorded because it is real on a watch too.** The first
`jsc-host` run of a session reports ~63 ms against a 33–36 ms median: cold
page-in of a 16 MB binary. quickjs-ng's 1 MB binary has no equivalent penalty.
Every number above is a median of 21 warm runs, which flatters JSC.

### Language level: JSC wins, by exactly one row

```
$ jsc es-probe.js                    $ qjs es-probe.js
-- 28/30 present                     -- 27/30 present
```

Both miss `structuredClone` and `TextEncoder` (host globals, not language).
The one difference is **`Intl`**, which JSC has and quickjs-ng does not — and
which is inseparable from JSC's mandatory ICU dependency, i.e. from the size
row. Everything else — optional chaining through `Object.groupBy`,
`Promise.withResolvers`, class static blocks, RegExp `/d` — is present on both.

**The control group passes.** [`nullish-probe.js`](./nullish-probe.js) is the
file that decided the PrimJS evaluation (PrimJS computes `null ?? x` wrong).
JSC prints `FB` on all nine rows, as expected. Running it anyway is the point:
a probe that only ever runs against the engine you expect to fail it is not a
probe.

### Stacks: line and column, right lines, different spelling, one lost name

`sh stack-probe.sh` builds the shipped gate's own fixture
(`js/test/fixtures/qbc-throw.entry.tsx`) through the real esbuild preset,
minified with an external map, and throws it at both shells.

```
quickjs-ng                                 jsc (jitless)
    at It (throw-bundle.js:1:21189)        It@throw-bundle.js:1:21158
    at Mt (throw-bundle.js:1:21234)        Mt@throw-bundle.js:1:21233
    at <anonymous> (…:1:21307)             @throw-bundle.js:1:21310
    at <eval> (…:1:21311)                  global code@throw-bundle.js:1:21346
```

**JSC carries the column.** That is the question that mattered — this project's
whole symbolication story rides on it, because a map lookup without a column
resolves every frame of a one-line bundle to the same place. Fed through the
**shipped** symbolicator (after rewriting `@` frames into the parenthesised
form, three lines of `sed` in `stack-probe.sh`):

| frame | quickjs-ng → `.tsx` | jsc → `.tsx` |
| --- | --- | --- |
| 1 (the throw, line 20) | **20:49** name `detail` | **20:13** name **unresolved** (`It` kept) |
| 2 (the call, line 30) | 30:55 name `props` | 30:28 name **`qbcSymbolicationInnerThrow`** |
| 3 (module scope, line 40) | 40:1 `QbcSymbolicationFixtureScreen` | 40:1 `QbcSymbolicationFixtureScreen` |
| 4 | 40:31 `<eval>` | 40:65 `global code` |

Both land on the right **lines**. The columns differ because the engines pick
different points of the expression: JSC reports the callee (`Error` at column
13 of the `throw new Error(...)` line; the called function at column 28 of the
call line), quickjs-ng reports further into the arguments. On frame 2 JSC's
choice is arguably better — it recovers the original function name where
quickjs-ng recovers a parameter name.

But `js/test/qbc-symbolication.test.ts` asserts
`expect(position?.name).toBe("detail")` on frame 1, and at column 13 the map has
no name, so the shipped gate **would fail on JSC** — on the name assertion, not
on the line or the column-range ones. That is a re-pin of an assertion, not a
broken feature; it is recorded here because "the gate still passes" would have
been the wrong summary.

## Stage 4 — would it even run on a watch?

See [`ADAPTER.md`](./ADAPTER.md) for the full seam analysis. The three answers
that decide the row:

**1. `JavaScriptCore.framework` is NOT in the watchOS SDK.** Apple's own
documentation index lists the framework's platforms as iOS, iPadOS, Mac
Catalyst, macOS, tvOS and visionOS — **no watchOS** — and every symbol page
(`JSContext`, `JSValue`, `JSVirtualMachine`) repeats the same six. The
`JSScript` bytecode-cache class is annotated `macos(10.15), ios(13.0)` in
WebKit's own header and has no documentation page at all. WebKit bug
[#212788](https://bugs.webkit.org/show_bug.cgi?id=212788) ("JavaScriptCore:
Support tvOS and watchOS builds with the public SDK", RESOLVED FIXED 2020) is
about building *WebKit's own tree* for those platforms against framework stubs
— not about third-party apps getting a system engine. So the roadmap's
system-framework premise is **confirmed**, and the only route is the one
measured here: ship your own copy.

**2. arm64_32 is fine — the opposite of the PrimJS finding.** WebKit derives
its address model from the pointer width, not the instruction set
(`PlatformCPU.h:306`, `#if __SIZEOF_POINTER__ == 8`), so watchOS's
`__aarch64__` + `__ILP32__` + `__SIZEOF_POINTER__ == 4` correctly selects
`CPU(ADDRESS32)` while `CPU(ARM64)` keeps `CPU(REGISTER64)` and therefore
`USE(JSVALUE64)` — precisely the arm64_32 model. The tree knows the platform by
name: `OS(WATCHOS)`/`PLATFORM(WATCHOS)` in WTF, an explicit
`// arm64_32 expects caller frame and return pc to use 8 bytes` in
`interpreter/CallFrame.h`, an `ARM64_32` backend mapping in
`offlineasm/backends.rb`, and a watchOS-specific `int128` workaround in
`PlatformHave.h`. **The CLoop's portability is real and this is not the
blocker.**

**3. ICU is not optional, and it is not counted anywhere above.** There is no
`ENABLE_INTL` switch; `OptionsJSCOnly.cmake` does
`find_package(ICU 70.1 REQUIRED …)`. On this machine ICU is linked dynamically
(30.8 MB of `libicudata` + 3.5 MB `libicui18n` + 2.1 MB `libicuuc`), so **none
of it appears in the 14 MB figure**. On Apple platforms JSC links
`libicucore.dylib`, which is in the shared cache and free — but is not a public
library. A self-built watchOS JSC would either link that (private) or build ICU
in (megabytes). quickjs-ng's answer to the same problem is 250 KB of
`libunicode.c` in the archive already counted.

**Licensing, as facts.** WebKit is a BSD/LGPL mix. In this tree, **185 of 3,223**
JavaScriptCore `.cpp`/`.h` files and **91 of 952** WTF files carry
LGPL headers ("GNU Library General Public License … version 2 … or any later
version", `COPYING.LIB`); the rest are BSD-2-Clause Apple headers. The LGPL
files are not peripheral — `parser/Parser.cpp`, `parser/Lexer.cpp`,
`runtime/Identifier.cpp`, `runtime/JSCell.cpp` are among them. This package is
MIT and its vendored quickjs-ng is MIT. Statically linking LGPL code into a
distributed binary engages LGPL §6's relinking provisions. Stating the fact,
not advising on it — but it is a new obligation this project does not currently
have, and it would need an answer before shipping, not after.

## Verdict

**Drop.** The measurement did not narrow the gap the roadmap estimated; it
widened it.

1. **The floor is the cap.** 16.2 MB RSS for an empty JSC context, against a
   documented 16 MB budget for the widget runtime. There is no bundle small
   enough to fix that, and the widget is not an optional target.
2. **14 MB of binary, before ICU.** The roadmap guessed "megabytes vs ~1 MB";
   the linked, stripped, dead-stripped number is **13.1×**, and the ICU that
   makes JSC's one language win possible is not in it.
3. **The shipping path disappears.** JSC cannot serialize bytecode from C at
   all, so `.qbc` — 5.5 ms of boot against 36.1 ms — has no counterpart, and
   `tools/qjs-compile`, the OTA compile path and the bytecode symbolication
   gate all lose their subject.
4. **No system framework to fall back to**, confirmed from Apple's docs, so
   none of the above can be traded away for "it's already on the device".
5. **In exchange:** `Intl`, one extra ES row, a faster parser, automatic
   microtask draining, automatic stack re-anchoring, and correct semantics
   everywhere. All real. None of them worth 13× the binary on the one platform
   this project exists for.

**Not "park", with one exception.** Park implies waiting for something, and the
things that decide this are structural. The single trigger that would reopen
the row is the one `docs/roadmap.md` already names: **Apple shipping a public
`JavaScriptCore.framework` in the watchOS SDK.** That would delete findings 1,
2 and 4 in one move — a shared-cache framework costs the app no bytes and no
floor — and would leave only the bytecode question, which the ObjC `JSScript`
cache would then plausibly answer. Nothing else changes the arithmetic.

The honest counterfactual, as with PrimJS: on macOS or iOS, where the framework
*is* public and the JIT *is* allowed, none of this analysis applies. JSC is not
a worse engine than quickjs-ng. It is a much larger one, and this project's
constraint is size.

## Reproducing

```sh
sh tools/jsconly-smoke/fetch-and-build.sh   # ~23 min cold on 4 cores, cached after
sh tools/jsconly-smoke/build-hosts.sh       # both hosts + the size table
sh tools/jsconly-smoke/measure.sh 21        # the side-by-side table
sh tools/jsconly-smoke/stack-probe.sh       # raw + symbolicated stacks, both engines

cd tools/jsconly-smoke
JSC=$(sh fetch-and-build.sh --jsc)
"$JSC" es-probe.js          # 28/30
"$JSC" nullish-probe.js     # all FB — the control group
./out/jsc-host ../../js/dist/bundle.js smoke-epilogue.js
```

Needs `clang`, `cmake`, `ninja`, `ruby`, `perl`, `python3`, `gperf`, `bison`,
`flex`, `libicu-dev` and network access to webkitgtk.org. `./out/` is
gitignored; the engine lives in `~/.cache/react-watchos/jsconly/` and nothing is
written inside the repo.

| file | what it is |
| --- | --- |
| `fetch-and-build.sh` | fetch webkitgtk 2.52.6 (sha256-verified), configure JSCOnly jitless, build, stage libs/headers/`jsc` |
| `jsc-host.c` | the JSC embedding — **read this for the API census**; the twin of `tools/embed-smoke/embed-host.c` |
| `smoke-epilogue.js` | the embed-smoke assertions as a file, so both engines run the identical text |
| `build-hosts.sh` | links both hosts and prints the size table |
| `measure.sh` | median-of-N side-by-side table |
| `stack-probe.sh` | the stack-quality comparison, through the shipped symbolicator |
| `build-stack-fixture.mts` | builds the shipped gate's throw fixture with the real esbuild preset |
| `es-probe.js`, `nullish-probe.js` | ported unchanged from `experiment/primjs-engine` so the scores are comparable |
| `ADAPTER.md` | the seam analysis (Stage 4) |
