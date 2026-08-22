# Tree diff / patch protocol — the measure-first pass (2026-08-22)

**Verdict: DECLINED again, now on decision-grade evidence — with the
prototype, the harness and cross-language fixtures kept so the revisit is
cheap.** The wire stays ONE shape (full serialized tree per commit). The
numbers below show a patch protocol would cut the JS serialize cost ~50-500×
*on the workloads where serialize dominates*, and exactly those workloads are
outside anything the framework currently produces or budgets for; on the
workloads apps actually run, the whole pipeline is already sub-millisecond in
the shipping engine. The revisit triggers are at the end — they are now
concrete numbers, not vibes.

This closes the roadmap's "what's next" #6 (*tree-diff — still measure-first*)
and supersedes the evidence (not the outcome) of the Track-2 row that dropped
tree-diff on a V8 microbench: NF-20 (the 2026-07-01 alternatives review)
correctly objected that the engine was wrong and the workload synthetic. This
pass measures real demo-app workloads in the vendored quickjs-ng AND the Swift
decode/apply side, plus a working patch prototype measured on the same
commits.

---

## 1. The question, and what already exists

Today every commit ships the FULL serialized tree over the (in-process) wire:
`serializeTree` + `JSON.stringify` in JS, one C-string hop, `JSONDecoder` into
`RNNode` on a background queue, then the NF-22 `root != tree.root` guard and a
SwiftUI re-diff on main. Three no-op layers already exist and are accounted
for below:

1. **React's own setState bailout** — an identical state value never renders
   at all. Measured: 0.01 ms/push, zero commits (`noopPush`).
2. **The NF-21 dirty flag** (`renderer.ts` `onCommit`) — a commit with no
   wire-visible mutation skips the O(tree) serialize+stringify entirely. What
   it saves per skip is the `perSerializeStringifyMs` column below.
3. **Byte-identical dedup + the Swift NF-22 equality guard** — a serialized
   payload identical to the last skips the bridge; an equal decoded tree
   skips the SwiftUI invalidation.

The question was whether a **fourth** mechanism — per-commit node patches
("commit protocol v2", alternatives review §2.3) — pays for itself on this
platform.

**Prior art** (surveyed in [prior-art.md](./prior-art.md) and the
[alternatives review](./system-architecture-review-2026-07-01-alternatives.md)
§2.2-2.3, per CLAUDE.md rule 3): RN Fabric diffs a C++ shadow tree into
minimal mutations; Raycast ships React + JSON-Patch + gzip across a real IPC
boundary; Flutter never serializes (same heap); SwiftUI itself is the
"send the whole value, diff at the consumer" model — which is what our
full-tree wire already delegates to. The pivotal in-repo observation stands:
**react-reconciler's mutation-mode host config already delivers the exact
per-node change stream** (`commitUpdate`/`commitTextUpdate`/`appendChild`/…)
— it is what sets the NF-21 boolean today, so widening that flag to a
`Set<id>` makes JS-side dirty tracking near-free. The prototype exploits
exactly that.

## 2. Method

Three harnesses, all kept, none shipping:

- **`tools/embed-smoke/bench-treediff.sh`** — runs the real demo bundle in
  the vendored quickjs-ng (the engine the watch ships) via the reference C
  host, drives the workloads below through the shipped event entrypoints, and
  times today's pipeline AND the patch prototype on the same commits. Also
  runs the widget bundle's timeline publish. Manual tooling; `bench.sh`
  (NF-20) stays the CI-recorded number.
- **`tools/embed-smoke/treediff-proto.js`** — the prototype itself: patch =
  `{root, upsert: [{id, type, props, children: [ids]}], removed: [ids]}`
  (node-granular; whole props per changed node; child lists by id — the
  {set/insert/remove} shape from §2.3, collapsed to one upsert list).
  `applyPatch` is a persistent path-copy that REUSES unchanged subtrees.
  One implementation, evaluated by both the engine bench and the vitest
  generator, so the semantics cannot fork.
- **`js/test/treediff-workloads.test.tsx`** + **`TreeDiffBenchTests.swift`**
  — the correctness pin and the native measurement. The vitest side drives
  the same demo workloads under V8, asserts `applyPatch(before, diff) ===
  after` for EVERY commit produced (~210 pairs: taps, appends, remounts,
  pops, the initial null→tree commit), and writes the `treediff-*` fixtures
  (real wire payloads + patches, byte-stable via a frozen `Date.now`). The
  Swift side re-applies the JS-produced patch over decoded `RNNode` values
  and asserts it reproduces the after-tree exactly — ARCH-11's
  cross-language-fixture discipline applied to the prototype — and prints
  decode/equality/apply timings.

Workloads (all real demo screens, driven through `__dispatchEvent` /
`__pushNativeEvent`): the counter tap (baseline), list append ×100 on
`/list/[id]`, one-row toggle on the resulting ~600-node stack, pop/push of
that stack, a scenePhase stream against `/stopwatch` alone (45 nodes) and
with the large stack mounted-but-covered underneath (603 nodes — covered
entries stay serialized), a same-payload push (no-op floor), the hydration
press including its widget republish, and the widget bundle's
`__renderWidgets`.

Caveats, per [performance-measurement.md](./performance-measurement.md):
x86-64 Linux, not an S-series core — treat absolutes as order-of-magnitude
and the RATIOS as the signal; three runs, one box, one sitting (spread was
<10% on every row except append-window warmup); Swift numbers from a
`-c release` build (the debug build `swift test` runs is noted where it
differs materially).

## 3. Numbers — engine side (vendored quickjs-ng, x86)

Full pipeline = React render + reconcile + serialize + stringify + C hop
(+ for pushes, the listener dispatch). "dirty-set patch" = building and
stringifying the prototype patch from known-changed ids — the cost a
production dirty-set serializer would pay INSTEAD of serialize+stringify.

| Workload | nodes | full wire | full pipeline | serialize+stringify | changed nodes | patch bytes | dirty-set patch build |
|---|---|---|---|---|---|---|---|
| counterTap | 50 | 4.2 KB | 0.63 ms | 0.31 ms | 1 | 0.14 KB | 0.008 ms |
| bigListToggle | 595 | 72.4 KB | 12.6-13.4 ms | 4.5 ms | 6 | 0.89 KB | 0.05 ms |
| navSwap push | 595 | 73.5 KB | 6.8 ms/swap | — | 542 (all new) | 72.3 KB | 2.7 ms |
| navSwap pop | 55 | 5.6 KB | (same) | — | 2 (+540 removed) | 3.4 KB | 0.09 ms |
| sensorSmall | 45 | 3.9 KB | 0.56-0.71 ms | 0.26 ms | 1 | 0.17 KB | 0.009 ms |
| **sensorDeep** | **603** | **74.2 KB** | **4.9-5.1 ms** | **4.4-5.5 ms** | **1** | **0.17 KB** | **0.009 ms** |
| noopPush | — | — | 0.01 ms, 0 commits | — | — | — | — |
| hydration (+republish) | 48 | 4.3 KB | 1.2 ms | — | — | — | — |
| widget publish | 57 (22 entries) | 8 KB | 0.94-1.07 ms | — | n/a — see §5 | — | — |

List append, growing (per append = 2 dispatches, TextField change + press):

| items | nodes | full wire | per append |
|---|---|---|---|
| 20 | 190 | 21.1 KB | 4.1 ms |
| 40 | 290 | 33.7 KB | 7.0 ms |
| 60 | 390 | 46.4 KB | 9.9 ms |
| 80 | 490 | 59.1 KB | 12.8 ms |
| 100 | 590 | 71.8 KB | 16.5 ms |

(An append's patch at full size: 9 changed nodes, 1.5 KB, 0.08 ms dirty-set
build. The post-hoc differ — diffing two serialized trees without reconciler
help — costs 5.6-6.3 ms on the 600-node tree, i.e. MORE than serializing;
only the dirty-set variant is viable, which is why the reconciler-already-
knows observation is load-bearing.)

QuickJS heap after the whole app run: 1.9 MB steady state (the harness's
retained commit history excluded); the classic bench's 48-node demo sits at
2.9-3.0 MB after its burst. Boot unchanged (~39 ms parse + ~5 ms eval,
source path).

## 4. Numbers — native side (Swift 6.2.3, Linux, release; 595-node fixture)

| Stage | ms | Note |
|---|---|---|
| `JSONDecoder` full decode, 73.5 KB | **10.7** | today's per-commit cost, off-main (`decodeQueue`); debug build: ~10.5 |
| same payload via `JSONSerialization` + hand-built tree | 5.8 | the try?-cascade in `JSONValue.init(from:)` is ~half the decode cost — a wire-neutral lever |
| full decode, 4.3 KB (demo-realistic 50 nodes) | 0.67 | |
| NF-22 equality, equal trees, independent decodes | 0.19 (debug 0.51) | what the guard pays to SKIP an identical commit |
| NF-22 equality, shared storage | 0.000 | Swift `==` fast-paths identical CoW storage |
| NF-22 equality, unequal trees | 0.006 | short-circuits — a real change pays ~nothing |
| patch decode + path-copy apply (incl. per-call index rebuild) | 0.32 | 33× cheaper than full decode; a store-based receiver would skip the index rebuild too |

Two native facts worth keeping even though the protocol is declined: the
**decoder, not the wire shape, is the native hot spot** (fixable ~2× with a
`JSONSerialization`-based `RNNode` builder, zero wire change — measured and
correctness-pinned in `TreeDiffBenchTests`), and **structural sharing makes
Swift equality effectively free** (0.000 ms), which is what would make a
patch-fed SwiftUI re-diff cheap if this is ever adopted.

## 5. Analysis on the axes that matter

- **Wire bytes are intra-process.** There is no bandwidth or radio cost; a
  73 KB commit string costs only the CPU/allocations that produce and parse
  it. Bytes are a proxy axis here, not a real one. (The one true byte cost —
  the widget App-Group document — is a full-document semantic by design:
  the extension is a discard-after-return process with no "previous tree",
  so a patch protocol cannot even apply to it. 8 KB / ~1 ms per publish is a
  non-problem.)
- **JS main-thread ms is the real axis** — the app's engine runs on the main
  thread. On realistic demo screens (45-90 nodes) the full pipeline is
  0.56-1.2 ms on x86, call it ~2-8 ms on an S-series core: fine for taps,
  acceptable at the sensor rates the bridges actually deliver (HR ~1 Hz,
  motion ≤10 Hz with coalescing). The case where the wire dominates is
  `sensorDeep`: a 600-node covered stack under a 10-20 Hz stream pays
  ~5 ms/push on x86 (~90% of it serialize+stringify), plausibly 15-50 ms on
  a watch — a real problem… that requires simultaneously (a) a screen ~6×
  larger than the demo's worst real screen, held mounted under (b) a
  high-frequency stream. The maxNodes=1000 budget tripwire (ARCH-13) sits
  precisely on that road and has never fired.
- **A tap on a big screen is NOT rescued by a diff.** `bigListToggle` is
  12.6-13.4 ms of which serialize+stringify is 4.5 ms — the other ~8 ms is
  React render/reconcile over the 104-row screen, which a wire change does
  not touch. Best case for a patch there: -35%. The streaming case is the
  only ~10× case, because its render half is one Text.
- **Native decode is off-main** (CX-008's `decodeQueue`), so its 10.7 ms is
  battery/CPU, not UI latency — and its cheapest fix is the decoder swap
  (§4), not a second wire shape.
- **Heap:** steady-state QuickJS heap with the 600-node stack retained is
  ~1.9-3 MB — nowhere near the 64 MB app cap; per-commit allocation churn is
  real but bounded by the same serialize cost already counted.
- **Navigation and boot gain nothing:** a pushed screen is all-new nodes
  (patch ≈ full tree: 72.3 KB vs 73.5 KB, and the patch build is not faster
  than the plain stringify), and the launch commit is inherently full.

## 6. What adopting would actually cost

The prototype works — every workload commit round-trips in JS and the same
patches re-apply byte-exactly over decoded `RNNode`s in Swift. That is the
cheap half. Shipping it means: a second wire MODE held to the same "one wire
shape, guarded three ways" standard (golden fixtures, ARCH-11 contract
tests, static-walker parity — which structurally CANNOT emit patches, so the
widget/app split becomes a mode split); a stale-base/resync protocol (the
prototype fails loud on a wrong base — that error path must become a
full-tree recovery request); a store-based mutable receiver on the Swift
side replacing the pure value swap, interacting with the optimistic
store/seq-ack and the generation guard; and the budgets/diagnostics
vocabulary doubling. Estimated 2-3 focused days per side (alternatives
review §2.3) plus permanent contract surface — against a measured win that
only exists beyond the documented budget envelope.

## 7. Verdict and revisit triggers

**Declined / parked.** Re-open when any of these is actually observed:

1. a real app profiles a screen (or covered stack) **≥ ~500 nodes committing
   at ≥ 5 Hz** — the `sensorDeep` shape; on today's numbers that is the only
   regime where the wire dominates and a dirty-set patch is a ~10× win;
2. the **ARCH-13 budget tripwires fire in a real consumer app** under a
   streaming update (maxNodes 1000 / 256 KB commit) — they sit exactly on
   the boundary this decision assumes stays uncrossed;
3. an **on-device Instruments trace attributes dropped frames or a
   double-digit %-of-core to the commit path** (the §5 device run in
   performance-measurement.md — still owed on other grounds).

If a trigger fires, the order of levers is already ranked by these numbers:
(a) coalesce/slow the stream (free); (b) shrink the tree (ARCH-09 did 3×);
(c) swap the native decoder (~2×, wire-neutral, measured); (d) THEN the
dirty-set patch protocol — whose JS half is the NF-21 flag widened to a Set,
whose shape+apply are prototyped here, and whose cross-language fixtures
already exist.

## 8. Incidental findings (kept honest, not fixed here)

- **A covered dynamic route loses its params.** `navigation.tsx` exposes
  `match.params` only to the FOCUSED route, so `/list/[id]` covered by
  another screen re-renders as its not-found branch ("List not found" in the
  demo) while still serialized in the committed tree; the params return on
  pop, so on-device this is a one-commit flash at most plus a wrong covered
  subtree in every commit while covered. Found because the deep-stack
  workload initially mounted the list UNDER the stopwatch and shrank to 64
  nodes. Worth its own small fix + test (params from the route's own stack
  entry, not from `active`).
- **`JSONValue`'s Codable decoder pays a try?-cascade per scalar** — §4:
  ~2× recoverable with a `JSONSerialization`-based builder, no wire change.
  The measurement and its correctness pin live in `TreeDiffBenchTests`.
- The `[mem]` line any embed-smoke epilogue prints includes whatever the
  epilogue retains — `bench-treediff.js` truncates the harness's commit
  history before exit so the heap line means the app, not the bench.

## 9. Reproducing

```sh
pnpm --filter react-watchos build          # dist/bundle.js + widget bundle
tools/embed-smoke/bench-treediff.sh        # engine workloads + widget publish
pnpm --filter react-watchos test           # regenerates treediff-* fixtures,
                                           # pins patch round-trip under V8
cd js/swift && swift test --filter TreeDiffBenchTests   # native timings
cd js/swift && swift test -c release --filter TreeDiffBenchTests  # §4 numbers
```
