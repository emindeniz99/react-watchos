# If we DID swap the engine: what the seam would cost

Design sketch, written after the Stage 1–3 measurements in
[`README.md`](./README.md). It exists so the "how hard would it be?" half of the
question has an answer even though the verdict is *don't*, and so that a future
engine evaluation — PrimJS or anything else — inherits a map of where this
project is actually coupled to quickjs-ng instead of rediscovering it.

Read `README.md` first for what was measured. This file assumes those results.

---

## 1. Where the engine is bolted in

Three places, and only three. That is better news than it sounds.

| Layer | File | Coupling |
| --- | --- | --- |
| SwiftPM target | `js/swift/Package.swift` — `.target(name: "CQuickJS")` | Vendored C sources compiled by SwiftPM; `ReactWatchRuntime` depends on it |
| Module surface | `js/swift/Sources/CQuickJS/include/module.modulemap` | Exposes `quickjs.h` + `quickjs-swift-shim.h` as the `CQuickJS` Clang module |
| The embedding | `js/swift/Sources/ReactWatchRuntime/JSRuntime.swift` (971 lines) | ~90 `JS_*` call sites |

Everything above `JSRuntime` — the SwiftUI interpreter, the widget runtime, the
wire models — talks to `JSRuntime`'s Swift API, not to the engine. So the blast
radius of an engine swap is one Swift file, one modulemap and one target.

`quickjs-swift-shim.h` is the detail that makes this tractable: it already
exists, it is *ours*, and it exists precisely because Swift cannot import C
macros. Every engine constant `JSRuntime` needs (`JS_UNDEFINED`,
`JS_EVAL_TYPE_GLOBAL`, `JS_READ_OBJ_BYTECODE`, …) is already funnelled through
seven `static inline` functions in that header. An engine swap re-points those
seven functions and the modulemap; it does not hunt macros through Swift.

## 2. Two ways to make the engine swappable

### Option A — a second SwiftPM target, selected at manifest time

Add `CPrimJS` beside `CQuickJS`, give it its own modulemap that vends the same
*spelling* (`quickjs.h` → the compat header in `./compat/`), and pick the
dependency in `Package.swift`:

```swift
let engine = ProcessInfo.processInfo.environment["REACT_WATCH_ENGINE"] == "primjs"
    ? "CPrimJS" : "CQuickJS"
.target(name: "ReactWatchRuntime", dependencies: [.target(name: engine)])
```

**What this buys:** `JSRuntime.swift` is untouched — it keeps saying `JS_Eval`,
and which archive that resolves to is a link-time decision.
**What it costs:** an env var in a manifest is invisible to consumers and to
Xcode; SwiftPM *package traits* (Swift 6.1+) are the supported spelling of the
same idea and would be the right vehicle. It also means the repo carries a
second engine's sources — the thing `fetch-and-build.sh` deliberately avoids —
because SwiftPM cannot fetch and CMake-build a C++ library as part of a target.
Realistically the engine would have to be vendored, or shipped as an
`.xcframework` binary target built on a Mac.

### Option B — a C shim wall

Define our own ~40-function `RWEngine_*` C API, implement it twice, and have
`JSRuntime.swift` call only that.

**What this buys:** the honest seam. The engine's vocabulary stops leaking into
Swift, and a third engine is a third implementation file rather than a third
round of edits to a 971-line Swift file.
**What it costs:** a real abstraction over two engines whose *semantics* differ
(see §3) is not a rename layer — it is a design, and it would be designed
against a sample size of two. Premature until there is a reason to run a second
engine at all.

**Recommendation if this were ever pursued:** Option A with package traits, and
`./compat/quickjs.h` promoted from experiment scaffolding to a real header. Not
Option B — §3 says the interesting work is not in the seam.

## 3. What `JSRuntime` touches that PrimJS would change

The rename is mechanical (`./compat/quickjs.h` does the whole thing in ~90
lines). These are the parts that are *not*:

| `JSRuntime.swift` uses | PrimJS | Consequence |
| --- | --- | --- |
| `JS_UpdateStackTop(runtime)` — 3 sites | **absent** | This is the ARCH-08 mechanism, not a nicety. `onOwningQueue` re-anchors the engine's stack guard at every outermost entry because "source/timer handlers run on whichever pool thread services the queue" and the widget runtime "is called from varying WidgetKit threads in production". Without it, a cross-thread entry either misfires as a spurious stack overflow or leaves the guard anchored to a dead stack. PrimJS offers `LEPUS_SetMaxStackSize`/`LEPUS_SetVirtualStackSize` — a *size*, not a *re-anchor*. No workaround from outside the engine. |
| `JS_SetHostPromiseRejectionTracker(rt, cb, nil)` | **absent** | PrimJS has `LEPUS_MoveUnhandledRejectionToException(ctx)` — a **pull** API where ours is **push**. The push callback fires on both "rejected with no handler" *and* "handled later" (the `is_handled` flag), which is what lets `pendingRejections` retract a rejection that got a `.catch` after the fact. A pull API cannot express that, so the unhandled-rejection reporting would need redesigning, not porting. |
| `JS_ComputeMemoryUsage(rt, &usage).memory_used_size` | **inert** | Writes nothing in a default build (proven by `heap-probe.c`). `tools/embed-smoke/run.sh`'s 6 MB budget gate is built on this field *because it is the one portable engine-side number* — RSS units differ per platform. Porting means either building PrimJS with the debugger enabled (dragging the inspector into the app) or re-basing the gate on `LEPUS_GetHeapSize()`, which measures something else. **This gate does not port.** |
| `JS_EvalFunction(ctx, fn)` | 3 args, not 2 | Every bytecode-boot call site needs an explicit `this`. Mechanical, but it is the *shipped* path (`evaluateBytecode`), so it is the one arity change that has to be right. |
| `JS_WriteObject(..., STRIP_SOURCE)` | flag absent | The OTA compile path in `JSRuntime` and `tools/qjs-compile` both pass it. Measured cost of losing it: **252,952 B → 501,861 B** on the app bundle (1.98×). See `README.md`. |
| `JS_GetVersion()` | absent | `VERSION.md`'s "which engine wrote this bytecode" stamp needs synthesizing from `LEPUS_GetPrimjsVersion()`'s undocumented packed `uint64`. |

Plus one that is not an API at all: **PrimJS is C++**. `ReactWatchRuntime` would
link `libc++`, and the `CQuickJS`-shaped SwiftPM target becomes a C++ target.
On watchOS `libc++` ships with the OS so the binary cost is ~0, but the Swift
↔ C++ story (`interoperabilityMode`, or keeping a pure-C wall in front) is a
real decision rather than a flag.

## 4. The watchOS / arm64_32 question

**This is the part a Mac cannot rescue, and it can be settled from Linux.**

Apple Watch Series 4 and later run **arm64_32**: the AArch64 instruction set
with **ILP32** — 32-bit pointers. Compiler-verified on this machine:

```
$ echo | clang -target arm64_32-apple-watchos8.0 -dM -E -x c - | grep -E '__aarch64__|__SIZEOF_POINTER__|__ILP32__'
#define __ILP32__ 1
#define __SIZEOF_POINTER__ 4
#define __aarch64__ 1
```

Now compare how the two engines choose their value representation:

**quickjs-ng** (`js/swift/Sources/CQuickJS/include/quickjs.h:174`) keys on the
**pointer width**:

```c
#ifndef JS_NAN_BOXING
#if INTPTR_MAX < INT64_MAX
#define JS_NAN_BOXING 1 /* Use NAN boxing for 32bit builds. */
```

→ arm64_32 has `INTPTR_MAX == INT32_MAX`, so it correctly takes the 32-bit
path. *This is why quickjs-ng works on the watch.*

**PrimJS** (`quickjs.h:93` and `:184`) keys on the **instruction set**:

```c
#if defined(__x86_64__) || defined(__aarch64__)
#define LEPUS_PTR64
...
#if defined(__aarch64__) && !defined(OS_WIN) && !DISABLE_NANBOX
```

→ arm64_32 defines `__aarch64__`, so PrimJS would assert 64-bit pointers **and**
select an AArch64 NaN-boxing scheme that packs pointers into a `double`
(`DOUBLE_ENCODE_OFFSET_BIT 49`, `NUMBER_TAG 0xfffe...`) — on a target whose
pointers are 4 bytes. Both branches are wrong for arm64_32, and fixing it means
patching PrimJS itself, in the value representation, on an architecture nobody
upstream builds for.

Corroborating evidence, all checkable from Linux:

- **Zero occurrences** of `watchos`, `arm64_32` or `armv7k` anywhere in
  PrimJS's tree (case-insensitive, whole repo).
- The **template interpreter** — the headline feature behind the "28% faster
  than QuickJS on Octane" claim — ships as **pre-generated raw AArch64 machine
  words** (`.word 0xf9400668`, i.e. `ldr x8, [x19,#8]`) in
  `src/interpreter/primjs/{ios,mac,android}/embedded.S`, 376 KB for iOS. Those
  are LP64 `x`-register encodings with 8-byte struct offsets. There is **no
  generator in the repo**, so this blob cannot be regenerated for arm64_32 by
  anyone outside Lynx. And there is no `watchos/` directory beside `ios/`.
- `config.gni:74`: `if (target_cpu != "arm64") { enable_primjs_snapshot = false;
  enable_compatible_mm = false }`, and `!enable_compatible_mm` in turn forces
  `enable_tracing_gc = false`. gn has no `arm64_32` `target_cpu` at all.
- Their CI runs `ubuntu-22.04` and `darwin-14`. `PrimJS.podspec` declares
  `s.ios.deployment_target = "9.0"` and no watchOS platform.

**What still needs a Mac** (i.e. what this experiment genuinely could not
answer):

1. Whether `clang -target arm64_32-apple-watchos` even *compiles* PrimJS's
   quickjs.cc once the header takes the wrong branch — the failure could be a
   clean `static_assert`, a pile of pointer-truncation warnings, or silent
   miscompilation. My prediction is "compiles with warnings, then corrupts
   values at runtime", which is the worst of the three, but it is a prediction.
2. The real on-device binary delta, with `embedded.S` disabled (it must be, on
   arm64_32) and `libc++` accounted for. §5's Linux number is a proxy only.
3. Whether the tracing GC and template interpreter — off on Linux, off on
   arm64_32 — change any conclusion. They cannot be measured on either, so the
   PrimJS we measured is PrimJS *without its two differentiators*.

Point 3 is the honest summary of the whole watchOS question: **on the target
this project ships to, PrimJS would be a QuickJS fork with a broken `??`, a
2× bytecode blob and no working heap accounting — none of the speed, because
the speed is arm64-LP64-only.**

## 5. Binary size, stated as a proxy

Measured on Linux x86_64, `clang -O2` hosts, engines at their own projects'
flags. **This is a proxy, not a watchOS number** — different architecture,
different pointer width, no `embedded.S`, and `libstdc++`/`libc++` resolved
dynamically rather than counted.

| | quickjs-ng | PrimJS | Δ |
| --- | --- | --- | --- |
| engine archive | 1,416,400 B (4 `.o`) | 1,820,356 B (`libquick.a`) | +28.5% |
| linked `embed-host`, `.text` | 1,057,682 B | 891,271 B | **−15.7%** |
| linked `embed-host`, stripped | 1,092,464 B | 921,520 B | **−15.6%** |

The archive is bigger but the *linked* result is smaller, because PrimJS builds
at `-Os` across ~27 translation units the linker can dead-strip, while
quickjs-ng is `-O2` over one large `quickjs.c`. Read the linked row, not the
archive row — it is the one that resembles an app binary.

On arm64_32 this would shift: no `embedded.S` (−376 KB of what an arm64 build
would have added), but the C++ runtime and PrimJS's GC/allocator subsystem
(`src/gc/*`, 14 translation units with no quickjs-ng counterpart) stay.

## 6. Vendor-bot implication

`tools/vendor-quickjs/run.sh` + `.github/workflows/vendor-quickjs.yml` +
`engine-attest.yml` are built around quickjs-ng's release shape, and **none of
those assumptions hold for PrimJS**:

| The bot assumes | quickjs-ng | PrimJS |
| --- | --- | --- |
| A source **tarball** per release to download and hash | `archive/refs/tags/vX.Y.Z.tar.gz` | No release assets; tags only. Would have to pin a **commit** and hash a git tree — a different trust primitive |
| A **SHA-256 confirmable through a second channel** (M9), gated by the `engine-digest-attested` label | Published digest | Nothing to confirm against. The whole attestation story would need re-inventing |
| A stable set of compiled sources to overwrite (`quickjs.c libregexp.c libunicode.c dtoa.c`) | 4 files | ~27 `.cc` across `src/gc`, `src/basic`, `src/interpreter` — plus a CMake build, so the "vendor the sources SwiftPM compiles" model breaks |
| Releases are engine releases | Every tag is | Tags interleave `weak-node-api-v*` (an unrelated package) with engine tags; `js/scripts/pick-quickjs-release.ts`'s soak policy would need a filter |
| `js/test/vendor-integrity.test.ts` pins a per-file `CHECKSUMS.sha256` | 4 files + curated headers | Would need regenerating over a much larger, CMake-selected file set |

So: a second bot, not a parameterization of the first. That is a standing
maintenance cost — and the reason `fetch-and-build.sh` fetches at a pinned
commit into an out-of-repo cache rather than vendoring: an experiment should
not create a supply-chain surface for a conclusion it has not reached yet.
