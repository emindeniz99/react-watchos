# PrimJS as an alternative engine — an experiment, and its answer

> **Status: experiment. Nothing here ships, nothing here is wired into a gate,
> and quickjs-ng remains the one engine this project runs.** Everything in this
> directory is additive: it fetches a second engine into an out-of-repo cache,
> links this repo's *existing, unmodified* C hosts against it, and measures the
> two side by side. `tools/vendored-qjs`, `tools/qjs-compile`,
> `tools/embed-smoke` and `js/swift/Sources/CQuickJS` are untouched.

**Question asked:** can [PrimJS](https://github.com/lynx-family/primjs) — Lynx's
QuickJS-descended engine with a template interpreter, Apache-2.0, advertising a
"QuickJS-compatible C API" — run this project's real production bundle, and how
does it compare to the vendored quickjs-ng on the measurements this repo
already uses?

**Answer: yes it runs the bundle, and no we should not use it.** It boots the
real 197 KB bundle, commits the tree and round-trips the counter — and it does
so while silently computing `null ?? x` wrong, which our production bundle does
47 times. Details below; the recommendation is at the bottom.

Pinned at PrimJS tag **`4.0.0`** (`7296488c03ae9da9ad5573f604518aa7e6c0c436`,
2026-07-16), measured against vendored **quickjs-ng 0.16.1** on one Linux
x86_64 machine.

---

## The headline: `??` is broken

PrimJS's nullish-coalescing operator falls through on `undefined` but **not on
`null`**, which the spec requires (ES2020 §13.15). It does not throw, warn, or
fail to parse — it returns the wrong value.

```
$ ./out/qjs-primjs nullish-probe.js     $ ./out/qjs-qjsng nullish-probe.js
literal       null   ✗                  literal       FB   ✓
variable      null   ✗                  variable      FB   ✓
call result   null   ✗                  call result   FB   ✓
property      null   ✗                  property      FB   ✓
array element null   ✗                  array element FB   ✓
nested        null   ✗                  nested        FB   ✓
undefined ctl FB                        undefined ctl FB
optchain ctl  FB                        optchain ctl  FB
```

Not a constant-folding artifact — wrong for a variable, a function return, a
property, an array element and nested, i.e. the operator and not the parser
(that is what [`nullish-probe.js`](./nullish-probe.js) is for). Not a build-flag
artifact either; it is visible in PrimJS's source, one line:

| engine | `??` codegen |
| --- | --- |
| quickjs-ng, `quickjs.c:28170` | `emit_op(s, OP_is_undefined_or_null);` |
| PrimJS, `quickjs.cc:22356` | `emit_op(s, OP_is_undefined);` |

PrimJS has **no `OP_is_undefined_or_null` opcode at all** (0 occurrences in both
`quickjs.cc` and `quickjs-opcode.h`), so this is not a typo — the opcode the
correct implementation needs was never added.

Why it matters here specifically: `js/esbuild/preset.mts` compiles to
`target: "es2020"`, so esbuild emits `??` **verbatim** rather than lowering it.
`js/dist/bundle.js` contains **47** `??` sites today, including
`m.status ?? 0`, `l.body ?? ""`, `lt.get(op) ?? null` and
`callback = t ?? null` inside React's own reconciler. The smoke test passed
only because the demo path happens to hit `undefined` operands, where PrimJS is
accidentally correct. A host returning `status: null` instead of omitting it
would produce a different app on PrimJS than on quickjs-ng, with nothing in any
log to say so.

**This alone disqualifies the engine**, independent of everything below.

## Stage 1 — build

`sh fetch-and-build.sh` shallow-clones the pinned commit into
`~/.cache/react-watchos/primjs/` and builds the `quickjs` target. It does **not**
vendor anything into the repo (rationale in the script header).

PrimJS's README documents a `gn`/`ninja` build behind `source tools/envsetup.sh
&& hab sync .`. The repo-root `CMakeLists.txt` builds the same `quickjs` target
with nothing but cmake + ninja + clang, so that is the path taken — no gn, no
depot_tools, no `hab`. Roughly 4 minutes cold, 27 translation units,
`libquick.a` = 1,820,356 B.

Two build findings worth recording:

- **clang is mandatory, not preferred.** `CMakeLists.txt` hard-codes `-faddrsig`
  and `-fno-sanitize=safe-stack` into `CMAKE_C_FLAGS`/`CMAKE_CXX_FLAGS`. GCC 13
  rejects both outright and the build cannot start. Nothing selects them by
  compiler.
- **The engine is C++.** Every source is a `.cc`, so a C embedder links
  `libstdc++`/`libc++`.

## Stage 2 — API compatibility

The four hosts (`tools/embed-smoke/embed-host.c`,
`tools/vendored-qjs/main.c`, `tools/qjs-compile/qjs-compile.c`,
`tools/qjs-compile/qbc-stack.c`) compile against PrimJS **completely unmodified**
— but only behind [`./compat/quickjs.h`](./compat/quickjs.h), a ~90-line bridge
put ahead of PrimJS's include directory on the search path. Compiled directly
against PrimJS's header, every one of them fails on line 1.

"QuickJS-compatible C API" turns out to mean *shape*, not *source*:

| # | Gap | Severity | Detail |
| --- | --- | --- | --- |
| 1 | Header is not valid C | blocks compile | Declares `bool` params and returns `false` from a `static inline`, never includes `<stdbool.h>`. Works only because all of PrimJS is C++. ~12 declarations affected. |
| 2 | **Header `#define`s `printf(...)` to nothing** | silent data loss | `quickjs.h`'s `DEBUG_MEMORY` block ends `#else / #define printf(...)`. Any C file including it stops printing, with no warning. `embed-host.c` writes its whole JSON result with `printf` — without an `#undef` the PrimJS host runs the bundle perfectly and reports nothing. |
| 3 | Every public symbol renamed `JS_*` → `LEPUS_*` | mechanical | Types too (`JSValue`→`LEPUSValue`, `JSRuntime`→`LEPUSRuntime`, …). Not even total: `JSAtom`, `JSString`, `JSMapRecord` keep the old spelling. |
| 4 | `js_free` → `lepus_free` | mechanical | Same contract. |
| 5 | `JS_EvalFunction` **arity change** | needs per-site thought | ng: `(ctx, fun_obj)`. PrimJS keeps Bellard's `(ctx, fun_obj, this_obj)`. A rename cannot bridge it. This is the shipped bytecode boot path. |
| 6 | `JS_WRITE_OBJ_STRIP_SOURCE` / `STRIP_DEBUG` **absent** | measurable cost | PrimJS has only Bellard's `BYTECODE`/`BSWAP`. `qjs-compile` passes `STRIP_SOURCE` unconditionally; losing it is the 2× blob in Stage 3. |
| 7 | `JS_GetVersion()` absent | cosmetic | `LEPUS_GetPrimjsVersion()` returns an undocumented packed `uint64`. |
| 8 | `JS_ComputeMemoryUsage` **writes nothing** | **loses a gate** | Every field stays 0 in a default build ("only available with debugger"). See Stage 3. |
| 9 | `JS_UpdateStackTop` **absent** | correctness | No equivalent. See [`ADAPTER.md`](./ADAPTER.md) §3. |
| 10 | `JS_SetHostPromiseRejectionTracker` **absent** | redesign | Only `LEPUS_MoveUnhandledRejectionToException` — a *pull* API where ours is *push*. |

Gaps 1–7 are what `compat/quickjs.h` fixes. Gaps 8–10 cannot be fixed from
outside the engine; 9 and 10 are only reachable from `JSRuntime.swift`, not from
the C hosts, which is why they appear here from code reading rather than from a
compile error.

## Stage 3 — running the real bundle

`sh measure.sh` → median of 21 runs, one machine, same 201,829 B minified
`js/dist/bundle.js`, both hosts `clang -O2`. Engines each built with their own
project's flags (ng `-O2`, PrimJS `-Os`+`-O3`) — "the engine as its maintainers
ship it" is the thing being compared.

**It boots.** Tree commits, navigation is accepted, counter goes 0 → 1, on both
the source path and the bytecode path:

```
{"nav":{"handled":true,"accepted":true},"result":{"handled":true,"accepted":true},
 "initialCount":"Count: 0","countAfterPress":"Count: 1"}
```

| engine / path | phase1 ms | eval ms | heap MB | peak RSS KB |
| --- | --- | --- | --- | --- |
| quickjs-ng source | 22.9 | 3.3 | 1.2 | 5,704 |
| PrimJS source | 26.2 | 4.1 | **0.0 (broken)** | 8,776 |
| quickjs-ng bytecode | 1.4 | 3.7 | 0.9 | 4,396 |
| PrimJS bytecode | 1.2 | 4.1 | **0.0 (broken)** | 6,532 |

The two timing columns are wall-clock on dev hardware, so they wander a few
percent between runs — the same reason `embed-smoke`'s boot tripwire is loose.
The heap, RSS and blob-size rows are stable.

Read as: **PrimJS is not faster here.** Parse is ~14% slower, eval ~11–24%
slower, RSS ~50% higher. That is *not* a refutation of PrimJS's 28%-Octane
claim — it is a consequence of the target. The template interpreter and tracing
GC are enabled only for arm64 with a pre-generated `embedded.S`, i.e. Android /
iOS / macOS; on Linux x86_64 they are off, which `heap-probe` confirms directly
(`LEPUS_IsGCModeRT` → `0`). **We measured PrimJS without its two
differentiators, and they cannot be turned on for watchOS either** — see
[`ADAPTER.md`](./ADAPTER.md) §4.

**Heap: the gate does not port.** `embed-smoke/run.sh`'s 6 MB budget reads
`JS_ComputeMemoryUsage().memory_used_size`, deliberately, because it is the one
*portable engine-side* number (RSS units differ per platform). On PrimJS that
call writes nothing at all — `heap-probe.c` memsets the struct first precisely
to tell "wrote 0" from "wrote nothing":

```
quickjs-ng   memory_used_size 1223141   malloc_size 1475088   obj_count 2039
PrimJS       memory_used_size       0   malloc_size       0   obj_count    0
             LEPUS_GetHeapSize 1544112  LEPUS_IsGCModeRT 0
```

`LEPUS_GetHeapSize()` works and gives 1,544,112 B (vs ng's `malloc_size`
1,475,088 B, ≈ +4.7%) — but it is a different metric, so adopting PrimJS means
re-basing the memory budget on a number that is not comparable to any figure in
`docs/budgets-and-limits.md`.

**Bytecode: it round-trips, at 2× the size.**

| | quickjs-ng | PrimJS |
| --- | --- | --- |
| `.qbc` from the 201,829 B bundle | 252,952 B | **501,861 B (1.98×)** |
| `JS_ReadObject` + `JS_EvalFunction` boots the app | yes | yes |

The gap is almost exactly the source text (201,829 B), because
`JS_WRITE_OBJ_STRIP_SOURCE` does not exist (gap 6). Note the blobs are mutually
unreadable — different serialization — so each engine must compile its own.

**Stacks: right shape, wrong positions.** This is the subtle one, and it matters
because the whole symbolication story rides on the column.

```
quickjs-ng:  at It (bundle.js:1:21189)     PrimJS:  at It (bundle.js:1:21193)
             at Mt (bundle.js:1:21234)              at Mt (bundle.js:1:21243)
             at <anonymous> (bundle.js:1:21307)     at <anonymous> (bundle.js:1:21343)
             at <eval> (bundle.js:1:21311)          at <eval> (bundle.js:1:21348)
```

PrimJS does emit `file:line:column`, same frames, same names, no `<null>` — so
at a glance it passes. But the columns point at the position **after** the call
returns, not at the call site (frame 1's column lands on the function's closing
brace; frame 3's lands on `;})();`). Fed through this repo's *shipped*
symbolicator (`js/scripts/symbolicate-core.ts`) against the real source map:

| frame | quickjs-ng → `.tsx` | PrimJS → `.tsx` |
| --- | --- | --- |
| 1 (the throw) | **20:49** `[detail]` ✓ the `throw` statement | **21:1** `[]` ✗ the closing brace |
| 2 | 30:55 `[props]` | 30:67 `[]` |
| 3 | 40:1 `[QbcSymbolicationFixtureScreen]` | 40:65 `[]` |

`js/test/qbc-symbolication.test.ts` would fail on PrimJS: it asserts the
resolved column lands between `throw` and `// THROW_MARKER` on the fixture's
real throw line, and PrimJS resolves to the wrong line entirely and loses every
identifier name.

**Language level.** `es-probe.js` runs 30 feature checks (each an `eval`'d
string, so an unsupported *syntax* is one red row rather than a dead run):

```
quickjs-ng  27/30 present     PrimJS  15/30 present
```

PrimJS is missing, among others: `??` correctness, `??=`/`||=`/`&&=` (parse
error), `String.replaceAll`, `Object.hasOwn`, **`Array.prototype.at`**, class
static blocks, `Error` `cause`, RegExp `/d`, `Array.findLast`/`toSorted`,
`Object.groupBy`, `Promise.withResolvers`. Both lack `structuredClone`,
`TextEncoder` and `Intl` (expected — and why `plurals-cldr` is in the deps).
"Fully supporting ES2019" is accurate advertising; this repo's preset targets
es2020 and its consumers write modern TypeScript.

## Stage 4 — the adapter seam

See [`ADAPTER.md`](./ADAPTER.md): where the engine is bolted in (3 places), two
ways to make it swappable, the 6 semantic gaps `JSRuntime.swift` would hit, the
arm64_32 analysis, binary size as a proxy, and why PrimJS would need its own
vendor bot.

The one line to carry out of it: **arm64_32 is a hard blocker, provable from
Linux.** quickjs-ng selects its value representation from `INTPTR_MAX`; PrimJS
selects it from `defined(__aarch64__)`. Apple Watch is `__aarch64__` **with
4-byte pointers**, so PrimJS would take the 64-bit pointer path *and* an AArch64
NaN-boxing scheme on an ILP32 target. There is no `watchos` string anywhere in
PrimJS's tree, and its template interpreter is a 376 KB blob of hand-encoded
LP64 AArch64 machine words with no generator in the repo.

## Verdict

**Drop.** Not "park" — park implies waiting for something to change, and the
three findings that decide it are structural rather than a matter of maturity:

1. **`??` is silently wrong for `null`**, in an engine we would be asking to run
   arbitrary consumer JavaScript, with 47 live sites in our own bundle today.
   A wrong-answer bug in a core operator is a different category from a missing
   feature; it means the engine cannot be trusted for the things we did not
   test.
2. **arm64_32 is unsupported by construction** — wrong branch selection, no
   watchOS anywhere upstream, and the performance features are an
   un-regenerable LP64 blob. The one platform this project exists for is the one
   PrimJS cannot target.
3. **We would trade away things we have**: a working portable heap gate, correct
   stack columns (and with them `pnpm symbolicate`), a 2× smaller bytecode blob,
   `JS_UpdateStackTop` (load-bearing for the widget runtime's cross-thread
   entries), and a vendor bot with a real attestation story.

In exchange for a template interpreter that does not run on our architecture.

The honest counterfactual: if this project targeted Android or iOS arm64,
PrimJS would deserve a real look — the Octane claim is plausible and the
engine is clearly production-grade *for Lynx's targets*. It just is not aimed at
ours. Worth keeping this directory as the record so the next person asking
"what about PrimJS?" gets numbers instead of a re-run.

## Reproducing

```sh
sh tools/primjs-smoke/fetch-and-build.sh   # ~4 min cold, cached after
sh tools/primjs-smoke/build-hosts.sh       # both engines × 5 hosts -> ./out/
sh tools/primjs-smoke/measure.sh 21        # the side-by-side table

# the individual findings (each host exists twice, -primjs and -qjsng)
cd tools/primjs-smoke
./out/qjs-primjs        nullish-probe.js     # the headline
./out/qjs-primjs        es-probe.js          # 15/30 vs ng's 27/30
./out/heap-probe-primjs ../../js/dist/bundle.js
./out/embed-host-primjs ../../js/dist/bundle.js
./out/qjs-compile-primjs ../../js/dist/bundle.js out/b.qbc && ./out/qbc-stack-primjs out/b.qbc
```

Needs `clang`, `cmake`, `ninja` and network access to GitHub.
`./out/` is gitignored; the engine cache lives in
`~/.cache/react-watchos/primjs/` and nothing is written inside the repo.

| file | what it is |
| --- | --- |
| `fetch-and-build.sh` | fetch PrimJS at the pinned commit, build `libquick.a` + headers into the cache |
| `compat/quickjs.h` | the `JS_*` → `LEPUS_*` bridge; **read this for the compatibility census** |
| `build-hosts.sh` | builds this repo's 4 unmodified hosts + `heap-probe` against BOTH engines |
| `measure.sh` | median-of-N side-by-side table |
| `heap-probe.c` | the only C written for this experiment; proves the memory API is inert |
| `nullish-probe.js` | the headline finding, smallest form |
| `es-probe.js` | 30 language-feature checks, one row each |
| `ADAPTER.md` | the design sketch (Stage 4) |
