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

---

# Upstream & platform follow-up — 2026-08-21

Everything above measures *this repo* against PrimJS 4.0.0. This section is the
outside-world half, done the same day on the maintainer's two challenges:
**(1)** is the `??` bug known/fixed upstream, and is it really just an "ES
version" thing we could compile around? **(2)** does the arm64_32 blocker
survive a higher watchOS floor, now that new watches are plain arm64?

Short answer: **finding 1 gets worse, finding 2 gets a real expiry date, and
the Drop stands for today.** Details, with sources.

## 1. The `??` bug is KNOWN upstream, still unfixed, and about six lines wide

**Known — reported sixteen months ago.**
[lynx-family/primjs#44, "`null ?? 3` returns `null`"](https://github.com/lynx-family/primjs/issues/44),
filed **2025-04-29** by [@benmccann](https://github.com/benmccann) — body in
full: *"We got this inside Lynx, so I assume it's coming from this project."*
Still **open**, with no comments, no labels and no linked PR as of 2026-08-21.
A repo-wide search finds no other issue and **no PR** mentioning
nullish / coalescing / `is_undefined_or_null`, and neither
[`lynx-family/lynx`](https://github.com/lynx-family/lynx) nor
[`lynx-family/lynx-stack`](https://github.com/lynx-family/lynx-stack) has one
either. So our finding is *independently reproduced*, not novel — which is the
worse of the two outcomes: it means the bug is reported and unprioritised, not
undiscovered.

**Still unfixed after the tag we measured.** Re-checked against `develop` HEAD
`c60a90dd47b3503c54835182c0ca501a1d4a174e` (2026-08-13), ~4 weeks of commits
past `4.0.0` (which is still the newest tag):

| check | `4.0.0` (measured above) | `develop` @ `c60a90dd` |
| --- | --- | --- |
| `??` codegen | `quickjs.cc:22356` → `emit_op(s, OP_is_undefined);` | `quickjs.cc:22624` → `emit_op(s, OP_is_undefined);` |
| `is_undefined_or_null` in `quickjs.cc` + `quickjs-opcode.h` | 0 | **0** |

**Lineage — the opcode was dropped from an inherited table.** Bellard's QuickJS
added the operator and the opcode it needs in the *same* release: the
[Changelog](https://bellard.org/quickjs/Changelog) for **2019-12-21** reads
"added nullish coalescing operator (ES2020)" and "added optional chaining
(ES2020)". In
[Bellard's opcode table](https://github.com/bellard/quickjs/blob/master/quickjs-opcode.h)
the opcode occupies one specific slot:

```
DEF(      strict_eq, …)
DEF(     strict_neq, …)
DEF(is_undefined_or_null, …)   ← Bellard and quickjs-ng
DEF(            and, …)
```

PrimJS's table (`src/interpreter/quickjs/include/quickjs-opcode.h:271-277`) is
`eq, neq, strict_eq, strict_neq, and, xor, or` — **exactly that hole**. So this
is a removal from a table PrimJS inherited, not an opcode nobody thought of.

**And the engine already contains the correct workaround for its own removal.**
`optional_chain_test()` (`quickjs.cc:20155` on develop) faces the identical
missing-opcode problem and solves it correctly, with a two-test dance:

```c
emit_op(s, OP_dup);  emit_op(s, OP_is_undefined);  label_next_1 = emit_goto(s, OP_if_true,  -1);
emit_op(s, OP_dup);  emit_op(s, OP_is_null);       label_next_2 = emit_goto(s, OP_if_false, -1);
```

`js_parse_cond_expr()` got the same rewrite **with the `OP_is_null` half
missing**. That reframes the finding: it is not an architectural gap, not a
bytecode-format constraint and not "the opcode was never added" — it is one
omitted test at one call site, fixable in ~6 lines using opcodes the engine
already ships and already emits three lines away. That matters for the revisit
trigger in §6: "upstream fixes `??`" is cheap for them.

**Fork base, for the record.** PrimJS's public history is a single squashed
`Initial commit` (`0715c769`, 2025-03-04), so the mistake predates
open-sourcing and no commit can be blamed. Bracketing by feature presence in the
4.0.0 tree against the QuickJS changelog, the base is a *selectively maintained*
2020-era QuickJS rather than any one tarball:

| QuickJS release | feature | in PrimJS 4.0.0? |
| --- | --- | --- |
| 2019-12-21 | `??`, optional chaining | **yes** (both, one broken) |
| 2020-01-05 | `String.prototype.replaceAll`, BigDecimal | no |
| 2020-04-12 | `Promise.any`, `AggregateError` | **yes** |
| 2020-09-06 | logical assignment (`??=`/`\|\|=`/`&&=`), IsHTMLDDA | no |
| 2020-11-08 | `JS_EvalThis()` | no |
| 2021-03-27 | `JS_UpdateStackTop()` | no — this is Stage-2 gap 9, now dated |

## 2. How a wrong `??` ships in production for sixteen months

Because Lynx's own toolchain never lets `??` reach PrimJS.

- Lynx documents the split outright: **"Main thread: ECMAScript 2019 (ES10)"**
  vs "Background thread: ECMAScript 2015 (ES6)" — and the main-thread runtime
  *is* PrimJS
  ([JavaScript Runtime](https://lynxjs.org/guide/scripting-runtime/index.html),
  [Main Thread Runtime](https://lynxjs.org/guide/scripting-runtime/main-thread-runtime)).
- `@lynx-js/rspeedy` implements that as a fixed SWC transform list whose **first
  entry** is `transform-nullish-coalescing-operator`
  ([`getESVersionTarget.ts`](https://github.com/lynx-family/lynx-stack/blob/main/packages/rspeedy/plugin-lynx/src/utils/getESVersionTarget.ts),
  [`loaders.ts`](https://github.com/lynx-family/lynx-stack/blob/main/packages/rspeedy/plugin-react/src/loaders.ts)):
  *"The main thread targets an es2019 engine, so its baseline is a platform
  constant — user `tools.swc.env.include` only extends the base/background
  config."*

In the first-party Lynx flow the operator is lowered to a `!= null` test before
the engine sees it. The bug is only reachable by hand-written main-thread
script, or by a **non-Lynx embedder evaluating ES2020 source** — which is
exactly what this repo would be. PrimJS's README line *"Fully supporting
ES2019"* is therefore not loose marketing; it is the real contract, and `??` is
one spec-year outside it. **We would be running the engine off-contract**, and
the parser accepting `??` without diagnostics is what makes that dangerous.

## 3. Draft upstream issue — written here, deliberately NOT filed

For the maintainer to file (or not) at
<https://github.com/lynx-family/primjs/issues>. Note #44 already exists and is
open: the better move is probably a comment on #44 carrying this diagnosis
rather than a second issue.

> **Title:** `??` compiles to `OP_is_undefined`, so `null ?? x` yields `null` (nullish coalescing ignores the null half)
>
> **Body:**
>
> Reproduction (`qjs` built from `CMakeLists.txt` at tag `4.0.0`, commit `7296488c`, also reproduced on `develop` @ `c60a90dd`):
>
> ```js
> console.log(null ?? 1);         // expected 1, got null
> console.log(undefined ?? 1);    // 1  (correct)
> const v = null; console.log(v ?? 1);            // null
> console.log((() => null)() ?? 1);               // null
> console.log(({ p: null }).p ?? 1);              // null
> ```
>
> Not constant folding and not the parser: it is wrong for a variable, a call result, a property and an array element alike. ES2020 §13.15 requires the right operand whenever the left is **either** `undefined` **or** `null`.
>
> **Cause** — `js_parse_cond_expr()` in `src/interpreter/quickjs/source/quickjs.cc` (line 22624 on `develop`, 22356 at `4.0.0`) emits only the `undefined` test:
>
> ```c
> emit_op(s, OP_dup);
> emit_op(s, OP_is_undefined);          // <-- only half the predicate
> emit_goto(s, OP_if_false, label1);
> emit_op(s, OP_drop);
> ```
>
> Upstream QuickJS emits `OP_is_undefined_or_null` here. PrimJS has no such opcode (0 occurrences in `quickjs.cc` and `quickjs-opcode.h`; the slot between `strict_neq` and `and` in the opcode table is empty), which appears to be why the site was rewritten.
>
> **Suggested fix** — PrimJS already performs the correct two-test expansion for the same missing opcode in `optional_chain_test()` (`quickjs.cc:20155`). Applying the same shape here needs no new opcode and no bytecode-version change:
>
> ```c
> int label_rhs = new_label(s);
> emit_op(s, OP_dup);
> emit_op(s, OP_is_undefined);
> emit_goto(s, OP_if_true, label_rhs);
> emit_op(s, OP_dup);
> emit_op(s, OP_is_null);
> emit_goto(s, OP_if_false, label1);
> emit_label(s, label_rhs);
> emit_op(s, OP_drop);
> ```
>
> **Why it matters beyond Lynx** — `@lynx-js/rspeedy` pins the main thread to an es2019 SWC baseline that includes `transform-nullish-coalescing-operator`, so first-party Lynx code never reaches this path. Any embedder evaluating ES2020+ source directly does, and gets a silently wrong value rather than a parse error. Same root cause as #44.
>
> **Also affected:** `a ??= b` does not parse at all (ES2021 logical assignment), so there is no `??=` path masking this.

## 4. "Would `target: es2019` make PrimJS safe?" — **No.** Measured, not argued

Yes, esbuild lowers `??` below `es2020`, so the *specific* headline bug becomes
unreachable from our bundles. It fixes **3 of the 12** gaps PrimJS has that
quickjs-ng does not, and leaves the other 9 exactly where they are — because
**esbuild lowers syntax and never injects polyfills for missing runtime
functions.** Verified locally with this repo's own `esbuild 0.28.1`, same
snippet at both targets:

```
                            --target=es2020            --target=es2019
null ?? 1              ->   a ?? 1                     a != null ? a : 1     ✅ fixed
y ??= 2                ->   y ?? (y = 2)               y != null ? y : y = 2 ✅ fixed
class C { static {…} } ->   lowered                    lowered               ✅ fixed
[1,2,3].at(-1)         ->   [1,2,3].at(-1)             [1,2,3].at(-1)        ❌ unchanged
Object.hasOwn({}, "k") ->   Object.hasOwn({}, "k")     Object.hasOwn({}, "k")❌ unchanged
"aa".replaceAll(…)     ->   "aa".replaceAll(…)         "aa".replaceAll(…)    ❌ unchanged
new Error(m,{cause:1}) ->   new Error(m,{cause:1})     new Error(m,{cause:1})❌ unchanged
Object.groupBy(…)      ->   Object.groupBy(…)          Object.groupBy(…)     ❌ unchanged
Promise.withResolvers()->   Promise.withResolvers()    Promise.withResolvers()❌ unchanged
/a/d                   ->   new RegExp("a","d")        new RegExp("a","d")   ❌ WORSE
```

Mapping that onto the 15/30-vs-27/30 gap (12 PrimJS-only misses; the shared 3
are `structuredClone`, `TextEncoder`, `Intl`):

| PrimJS-only gap | kind | does a lower target help? |
| --- | --- | --- |
| `??` correctness | syntax | **yes** — lowered to `!= null` |
| `??=` / `\|\|=` / `&&=` | syntax | **yes** |
| class `static {}` | syntax | **yes** |
| `String.prototype.replaceAll` | runtime fn | no |
| `Object.hasOwn` | runtime fn | no |
| `Array.prototype.at` | runtime fn | no |
| `Error` `cause` option | runtime | no |
| `Array.prototype.findLast` | runtime fn | no |
| `Array.prototype.toSorted` | runtime fn | no |
| `Object.groupBy` | runtime fn | no |
| `Promise.withResolvers` | runtime fn | no |
| RegExp `/d` (`hasIndices`) | flag | **no — and it degrades**: esbuild rewrites the literal to `new RegExp("a","d")`, converting a build-time diagnostic into a runtime throw |

Three further reasons the target knob is the wrong lever here, all specific to
this repo:

1. **`target` is consumer-facing.** `js/esbuild/preset.mts` ships as
   `react-watchos/build`; its comment already treats `es2020` as *"a CONSUMER-FACING
   FLOOR, not an engine limit"*. Lowering it re-caps every consumer app's
   syntax to buy a workaround for one engine we do not ship.
2. **Down-levelling costs bytes, not saves them** — the preset's own measurement
   (2026-08-21) is that *raising* the target buys 393 B; lowering pays that back
   and then some, plus optional-chaining temporaries.
3. **It only covers code we compile.** OTA ships JS *source* evaluated by the
   engine baked into the installed binary; a bundle produced by any other
   toolchain, an `eval`'d string, or a consumer who compiles their own asset all
   route around the mitigation. Correct-by-engine beats correct-by-convention
   for a wrong-answer bug.

So: **no, this is not an "ES version" thing.** It is a wrong-answer bug in an
operator, plus nine runtime functions a target setting cannot conjure. The right
framing is the one PrimJS's README already gives — it targets ES2019, and this
repo and its consumers do not.

## 5. The arm64 watch matrix — the blocker that IS floor-dependent

The maintainer's counter is **correct in principle and premature in practice**.

**(a) Which watch runs which architecture for third-party apps.** The arch is a
function of *(device, watchOS)*, not device alone: S9-class silicon ran
`arm64_32` apps under watchOS 10/11 and only became an `arm64` target with
**watchOS 26** (Sept 2025).

| SoC / models | third-party app arch | earliest watchOS | latest watchOS |
| --- | --- | --- | --- |
| S1 — Apple Watch (1st gen) | `armv7k` | 1.0 | 4.3.2 |
| S1P / S2 — Series 1, Series 2 | `armv7k` | 3.0 | 6.x (dropped at 7) |
| S3 — Series 3 | `armv7k` | 4.0 | 8.x (dropped at 9) |
| S4 — Series 4 | `arm64_32` | 5.0 | 10.x (dropped at 11) |
| S5 — Series 5, SE (1st gen) | `arm64_32` | 6.0 / 7.0 | 10.x (dropped at 11) |
| S6 — Series 6 | `arm64_32` | 7.0 | 26.x (dropped at 27) |
| S7 — Series 7 | `arm64_32` | 8.0 | 26.x (dropped at 27) |
| S8 — Series 8, SE (2nd gen), Ultra | `arm64_32` | 9.0 | 26.x (dropped at 27) |
| S9 — Series 9, Ultra 2 | `arm64_32` ≤ 25 → **`arm64` from 26** | 10.0 | 27 |
| S10 — Series 10 | `arm64_32` ≤ 25 → **`arm64` from 26** | 11.0 | 27 |
| S10 — Series 11, Ultra 3, SE (3rd gen) | **`arm64`** | 26.0 | 27 |

Sources: WWDC25 *What's new in watchOS 26* — *"Apple Watch Series 9 and later,
and Apple Watch Ultra 2 now use the arm64 architecture on watchOS 26… In Xcode,
use the Standard Architecture's build setting"*
([session 334](https://developer.apple.com/videos/play/wwdc2025/334/));
[heise, 2025-06-18](https://www.heise.de/en/news/watchOS-Apple-switches-to-arm64-but-not-for-all-Watch-models-10451081.html)
and [MacRumors, 2025-06-16](https://www.macrumors.com/2025/06/16/watchos-26-moves-apple-watch-to-new-architecture/)
for the model split and the arm64_32 compatibility layer;
[LLVM PR #152235](https://github.com/llvm/llvm-project/pull/152235) for the
toolchain-side gate (*"arm64 (non-e, non-32) watchOS comes later, and requires
S6 anyway"*, with `arm64-apple-watchos26` as the first such triple);
[Elements docs](https://docs.elementscompiler.com/Platforms/Cocoa/CpuArchitectures/)
for `armv7k` = original watch … Series 3 and `arm64_32` = Series 4 and later.
There is no S11: the 2025 trio (Series 11, Ultra 3, SE 3) all ship the **S10**
([MacRumors, 2025-09-09](https://www.macrumors.com/2025/09/09/no-new-apple-watch-chip-for-the-first-time/)),
which is why the arm64 set is contiguous from S9 onward.
Device-support cutoffs:
[watchOS 10 = Series 4+](https://www.macrumors.com/2023/06/05/watchos-10-compatibility/),
[watchOS 11 = Series 6+/SE2/Ultra](https://www.iclarified.com/93907/watchos-11-supported-devices),
[watchOS 26 = Series 6+/SE2+/Ultra+](https://9to5mac.com/2025/06/09/heres-every-apple-watch-that-will-support-watchos-26/),
[watchOS 27 = SE 3, Series 9/10/11, Ultra 2/3](https://9to5mac.com/2026/06/08/watchos-27-compatibility-list/).

**(b) The floor at which "arm64-only" becomes real: watchOS 27.**
watchOS 26 still supports Series 6/7/8/SE 2/Ultra 1 — all `arm64_32` — so a
watchOS-26 floor still needs the slice. **watchOS 27** (announced 2026-06-08,
shipping autumn 2026) supports *only* SE 3, Series 9, Series 10, Series 11,
Ultra 2, Ultra 3 — i.e. exactly the `arm64` set. Apple's stated reason is
"power and performance", not architecture
([MacRumors, 2026-06-19](https://www.macrumors.com/2026/06/19/apple-explains-why-watchos-27-drops-support/)),
but the two sets coincide exactly, and Apple describes both with the same
phrase — *"Series 9 and later, Ultra 2 and later"*. So:

> **At a floor of watchOS 27.0, zero supported devices are `arm64_32`, and an
> arm64-only watch package is coherent for the first time.**

**(c) What this repo is today, and what the App Store requires.**

- Floor: **watchOS 10.0** — `js/swift/Package.swift:112` (`.watchOS(.v10)`) and
  the config plugin's `deploymentTarget: o.deploymentTarget ?? "10.0"`
  (`js/plugin/index.cts:122`). At that floor the oldest supported device is
  Series 4, an `arm64_32` device. **`arm64_32` is mandatory for us today.** No
  `ARCHS`/`EXCLUDED_ARCHS` is set anywhere in the repo, so targets inherit
  Xcode's Standard Architectures.
- The App Store now requires the **other** slice: *"Beginning April 2026,
  watchOS apps uploaded to App Store Connect must also include 64-bit support
  and be built with the watchOS 26 SDK"*
  ([Apple Developer News, 2025-07-22](https://developer.apple.com/news/?id=zt8rydnt)).
  That deadline is **already in force**. So a submission today needs `arm64`,
  and — at any floor below 27 — still needs `arm64_32`: a fat binary, both
  slices.
- Apple publishes no rule *requiring* `arm64_32`; the constraint is purely
  which devices you want to reach. Apple DTS, asked exactly this ("should we go
  arm64-only?"), answered: *"No — … There are many Apple Watch devices that run
  watchOS versions your app likely supports beyond that list, so you need to
  keep the `arm64_32` architecture around for those devices"*
  ([forums thread 810101](https://developer.apple.com/forums/thread/810101)) —
  a statement about *device coverage*, which evaporates when the deployment
  target is 27.0. Xcode 27 beta 5's release notes announce the analogous
  auto-drop only for macOS (`ARCHS_STANDARD` loses `x86_64` at
  `MACOSX_DEPLOYMENT_TARGET >= 27.0`) and say nothing about watchOS, so at a
  27.0 floor the `arm64_32` slice would likely still be *built* by Standard
  Architectures and have to be dropped explicitly. Xcode 27's minimum watchOS
  deployment target is watchOS 10 — our current floor is at the edge of what
  the newest toolchain still accepts
  ([Xcode Support](https://developer.apple.com/support/xcode/)).

**Verdict on the floor.** "arm64-only watch package" becomes real at **watchOS
27.0** and not one release earlier. Is that floor sane in 2026? **No — not
yet.** watchOS 27 has not shipped as of 2026-08-21 (announced June, autumn
release), so a 27.0 floor today means an installed base of approximately zero,
and cuts every watch older than Sept 2023 plus the entire Series 6/7/8/SE 2/
Ultra 1 population that watchOS 26 still supports. Compare the package's
current floor (watchOS 10, Sept 2023) — three years of back-compat. A 27.0
floor is plausibly sane around **2027–2028**, once watchOS 27 adoption is high
and the S8-and-older cohort has churned; a 26.0 floor is the sane *next* step,
and it does **not** buy arm64-only.

**What this does to the ADAPTER.md arm64_32 analysis.** It stands for our floor
and expires at 27.0. PrimJS keys its value representation on `__aarch64__`
rather than `INTPTR_MAX`, which is wrong on ILP32 `arm64_32` — but on a plain
`arm64` watch it would be **right**, and the template interpreter's
hand-encoded LP64 AArch64 `embedded.S` would be targeting the correct pointer
size. It remains true that there is **no `watchos` string anywhere in PrimJS's
tree**, that no build config exists for the platform, and that the blob has no
generator upstream — so "PrimJS could target arm64 watchOS" would still be a
port someone has to do and maintain, not a flag. But "unsupported **by
construction**" is too strong once the floor is 27.0; the accurate statement is
*"unsupported by construction on every watch this package currently supports."*

## 6. Does any of this change the Drop?

**No — and the honest reason is that neither half of the trigger has fired.**
The `??` bug is worse than we thought in one way (known upstream for sixteen
months with no maintainer response, no PR, no mention in PrimJS's own
`docs/unsupported_sepcifications.md`, which catalogues dozens of far more
obscure deviations) and better in another (it is a ~6-line fix using opcodes the
engine already emits three lines away, not an architectural hole). The
arm64_32 objection is no longer permanent: it has a date, watchOS 27.0. But
today, at a watchOS 10 floor, `arm64_32` is mandatory and Apple additionally
mandates an `arm64` slice as of April 2026 — so PrimJS would have to work on
the architecture it gets wrong, and lowering our esbuild target to `es2019`
would mitigate 3 of its 12 gaps while leaving nine runtime functions and one
degraded regexp path untouched, and would re-cap every consumer's syntax to do
it. Everything else in the Verdict — the inert heap gate, the wrong stack
columns, the 2× bytecode blob, the missing `JS_UpdateStackTop`, the pull-shaped
rejection API — is unmoved.

**The revisit trigger, now that it can be written precisely.** Reopen this
directory only when *both* hold:

1. **Upstream fixes `??`** — i.e. `js_parse_cond_expr` tests `OP_is_null` too,
   in a tagged release, and `nullish-probe.js` prints 8 green rows against it;
   and
2. **this package's floor reaches watchOS 27.0**, so the shipped slice set is
   `arm64` only and PrimJS's `__aarch64__`-keyed value representation is
   correct for the target.

Neither holds on 2026-08-21. (1) has been open since 2025-04-29; (2) is a floor
this project should not take for at least another year. Both are checkable in
minutes — `git grep is_undefined_or_null` on `develop`, and
`js/swift/Package.swift:112` — which is the point of writing them down.
