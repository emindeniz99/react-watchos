# Full code review — Claude Opus — 2026-06-25

Independent read of the whole `react-native-watchos` project: the TypeScript
reconciler, the QuickJS embedding, the Swift runtime + SwiftUI interpreter, the
widget/intent extension, OTA, native capability bridges, the Expo config
plugin, packaging, examples, and tests.

- **Reviewer:** Claude Opus 4.8
- **Reviewed commit:** `main` at `17c8bc0`
- **Method:** read the source directly (not a re-run of Codex); every claim
  below cites `file:line` at this commit. Where I only have second-hand signal
  I say so.
- **Relationship to the other reviews:** the CR-1…CR-17 backlog
  ([code-review-2026-06-25.md](./code-review-2026-06-25.md)) is **done and
  green** (51 Swift + 189 JS tests). A separate Codex backlog
  ([…-1735-codex.md](./code-review-2026-06-25-1735-codex.md), CX-001…CX-028)
  reviewed an *older* commit (`fdaa058`). This document is my own pass; it
  reconciles with Codex so there is **one** plan, not three.

---

## Verdict

The architecture is genuinely good and unusually well-tested for an early
watchOS runtime: a clean reconciler → JSON-tree → SwiftUI interpreter, a
Linux-testable split (`ReactWatchSupport`/`Core` pure, `Runtime` engine-only,
`Host` watchOS-only), fail-loud async error handling (drainJobs + rejection
tracker), and an optimistic-input model keyed by node id. That foundation is
not in question.

What is **not** ready:

1. **Packaging will publish hundreds of MB of Swift build output** (CX-001).
   Hard blocker for any `npm publish`.
2. **The OTA safety guarantee you care about — "old JS must never touch the
   new-schema db" — has four holes** (CX-003, CX-004, CX-006/OP-1, CX-007).
   The biggest is that the *widget extension* is completely ungated: it keeps
   running the binary's old JS and writing the shared App Group store even
   after the app moves to a new OTA bundle.
3. **`generateText` has the wrong availability gate** (CX-002). Foundation
   Models *is* on watchOS — **27.0+ (beta)**, via `SystemLanguageModel`,
   verified against Apple's docs — but the code gates on `#available(watchOS
   26.0, *)`, so it won't compile against the watchOS 27 SDK (`LanguageModelSession`
   is annotated 27.0+) and silently rejects when built with an older one. A real
   feature with a version bug, **not** the dead API Codex (and my first pass)
   assumed.

Everything else is correctness/cleanup that can follow.

---

## What's solid (so the plan doesn't "fix" it)

- `drainJobs()` + `promiseRejectionTracker` ([JSRuntime.swift:431](../js/swift/Sources/ReactWatchRuntime/JSRuntime.swift), :503) — async failures are surfaced, not swallowed.
- No-op commit dedup ([renderer.ts:231](../js/src/renderer.ts)) and the urgent-priority `runSync` path for native pushes.
- Optimistic store keyed by node id, released on ack not on value-change ([NodeView.swift:298](../js/swift/Sources/ReactWatchHost/NodeView.swift)) — survives view-identity churn. Correct and subtle.
- The `#if os(watchOS)` host split that makes `swift test` run on macOS.
- OTA *bones* are right: sign-at-save over `v1:<version>:<js>`, anti-rollback high-water, hard gate, on-device bytecode cache. The gaps below are in the wiring, not the design intent.

---

## My findings beyond the Codex backlog

These are not in CX-001…CX-028. Cited at `17c8bc0`.

- [ ] **OP-1 — the OTA bytecode cache can silently run *stale* code.**
  `persistOTA` writes source, then meta, then calls `cacheOTABytecode`
  independently ([ReactWatchHost.swift:201](../js/swift/Sources/ReactWatchHost/ReactWatchHost.swift)). If the process dies after the
  source write but before `cacheOTABytecode` overwrites it, the *previous*
  bundle's `ota-bundle.qbc` stays on disk paired with the *new* source. On next
  boot `evaluateOTA` prefers the bytecode ([:376](../js/swift/Sources/ReactWatchHost/ReactWatchHost.swift)), which is valid for the
  engine version and loads fine — so the watch runs **old code that doesn't
  match the persisted source or the version in meta**, with no error. This is a
  sharper, scarier instance of CX-006. **Fix:** key the bytecode to a hash of
  the source (store the hash in meta) and refuse the cache on mismatch; or make
  the whole apply atomic (stage in a temp dir, fsync, swap one pointer).
  Severity: **high** (silent wrong-code execution).

- [ ] **OP-2 — no thread assertion on the JS settle methods.** The QuickJS
  context is single-threaded and lives on main; the doc comments say so
  ([JSRuntime.swift:169](../js/swift/Sources/ReactWatchRuntime/JSRuntime.swift)) but nothing enforces it. `performFetch` correctly hops to
  main ([ReactWatchHost.swift:538](../js/swift/Sources/ReactWatchHost/ReactWatchHost.swift)); the sensor/BLE bridges should be audited to
  prove the same. A single stray call from a background queue is *silent heap
  corruption*, not a crash. **Fix:** `dispatchPrecondition(condition:
  .onQueue(.main))` (DEBUG) in `bridgeCall`/the public settle methods, and an
  audit of every `runtime?.` call site. Severity: medium (latent, hard to
  debug).

- [ ] **OP-3 — the app's QuickJS heap is uncapped.** Only the widget passes a
  limit (`16MB`, [IntentRuntime.swift:28](../app/targets/widget/IntentRuntime.swift)); the app calls `JSRuntime()` with no
  cap ([ReactWatchHost.swift:406](../js/swift/Sources/ReactWatchHost/ReactWatchHost.swift)). A large/runaway OTA bundle OOM-jetsams the app
  instead of failing loudly. **Fix:** pass a generous cap (e.g. 48–64MB) so
  QuickJS throws before the OS kills the process. Severity: low/defensive.

- [ ] **OP-4 — `Int32(truncatingIfNeeded:)` on seq/ids.** `makeValue`
  ([JSRuntime.swift:264](../js/swift/Sources/ReactWatchRuntime/JSRuntime.swift)) truncates 64→32 bits for nodeId/seq/timer/fetch/generate
  ids. All are realistically < 2³¹, but a marathon session's monotonic `seq`
  could wrap silently and mis-ack an optimistic control. **Fix:** `JS_NewInt64`
  for `seq`, or assert the bound. Severity: low.

- [ ] **OP-5 — `describe()` appends `\nundefined` for non-Error rejections.**
  A `Promise.reject("string")` or rejected primitive has no `.stack`, but the
  code reads it and appends unless empty ([JSRuntime.swift:464](../js/swift/Sources/ReactWatchRuntime/JSRuntime.swift)) — `"undefined"`
  is non-empty, so the dev overlay shows `reason\nundefined`. **Fix:** guard on
  `JS_IsError` or skip a `"undefined"` stack. Severity: cosmetic.

- [ ] **OP-6 — Map annotation identity is the array offset.** `ForEach(...,
  id: \.offset)` ([NodeView.swift:320](../js/swift/Sources/ReactWatchHost/NodeView.swift)) churns SwiftUI identity when annotations
  reorder, re-dropping every marker. **Fix:** derive a stable id from
  lat/lon/title. Severity: low (cosmetic animation).

---

## Reconciliation with the Codex backlog (CX-001…CX-028)

I read the code behind each P0/P1 and the representative P2/P3 items. Status is
my independent assessment, not Codex's.

| CX | My assessment | Note |
|----|---------------|------|
| **CX-001** packaging ships `swift/.build` | **Confirmed, P0** | [package.json:57](../js/package.json) `files:["swift"]`; no `license`. ~hours. |
| **CX-002** Foundation Models gate wrong | **Reclassified — fixable, not "remove"** | FM *is* on watchOS 27.0+ (beta) via `SystemLanguageModel` (verified vs Apple docs). Bug: gate is `#available(watchOS 26.0, *)` ([ReactWatchHost.swift:292](../js/swift/Sources/ReactWatchHost/ReactWatchHost.swift)) — must be 27.0; the branch only compiles with the watchOS 27 SDK; `maxTokens` ([ai.ts:35](../js/src/ai.ts)) still unimplemented; add a capability query. |
| **CX-003** malformed key → fail-open | **Confirmed, P0** | [ReactWatchHost.swift:73](../js/swift/Sources/ReactWatchHost/ReactWatchHost.swift); silently selects the unsigned branch at :192. Undermines the hard gate you opted into. |
| **CX-004** widget runs stale JS post-OTA | **Confirmed, P0-for-you** | [IntentRuntime.swift:50](../app/targets/widget/IntentRuntime.swift) loads only `Bundle.main`; its handlers write the shared store. *This is the db-corruption hole.* |
| **CX-005** `applyUpdate` reports success early | **Confirmed** | [update.ts:29](../js/src/update.ts),:85 — `void`/version returned before native accepts. |
| **CX-006** OTA persistence not transactional | **Confirmed** (+ see OP-1) | [ReactWatchHost.swift:201](../js/swift/Sources/ReactWatchHost/ReactWatchHost.swift). |
| **CX-007** freshness vs compile-time version | **Confirmed, sharper** | Your "bump only on breaking change" rule means `fetchAndApplyUpdate` (`version >`, [update.ts:81](../js/src/update.ts)) **never ships a non-breaking fix**. Version is doing two jobs. |
| **CX-008** reload doesn't cancel async work | **Confirmed** | `boot()` resets `nextSeq` + drops runtime ([ReactWatchHost.swift:107](../js/swift/Sources/ReactWatchHost/ReactWatchHost.swift)) but never cancels `fetchTasks`/sensors/BLE → old fetch can resolve a reused id. |
| **CX-009** wire mismatch still renders | **Confirmed** | [ReactWatchHost.swift:421](../js/swift/Sources/ReactWatchHost/ReactWatchHost.swift) warns then `self.root = tree.root` and advances the ack. |
| **CX-010** handlerless/throwing events strand optimistic | **Confirmed** | [renderer.ts:275](../js/src/renderer.ts) bumps `lastSeq` then `return false` before the ack-commit; [events.ts:24](../js/src/events.ts) handler call isn't try-caught. The wire already carries `onChange:true` ([serialize.ts:17](../js/src/serialize.ts)) — the interpreter just ignores it. |
| **CX-011** plugin doesn't remove stale targets | **Confirmed** | [plugin/index.js](../js/plugin/index.js) only *adds* under `if (opts.widget)`; no removal on `widget:false`. |
| CX-012 not a one-line integration | Plausible (DX) | Still needs `postprebuild` for linking/Info.plist. Larger. |
| **CX-013** native build as required CI gate | **Disagree — skip** | Conflicts with your standing *"GitHub Actions intentionally disabled"* decision. Keep manual. |
| **CX-014** sensor start/stop has no refcount | **Confirmed** | [sensors.ts:34](../js/src/sensors.ts) — one unmount kills a shared stream. Clean JS-only fix. |
| **CX-015** Map region props ignored | **Confirmed** | [NodeView.swift:316](../js/swift/Sources/ReactWatchHost/NodeView.swift) reads only annotations/route/height; `latitude/longitude/span` ([components.ts:235](../js/src/components.ts)) unused. |
| **CX-016** snapshot picks a future entry | **Confirmed** | [ReactWidgets.swift:72](../app/targets/widget/ReactWidgets.swift) `latestEntry` uses `.entries.last`. |
| **CX-017** `relevantContexts` serialized, not applied | **Confirmed** | [ReactWidgets.swift:55](../app/targets/widget/ReactWidgets.swift) decodes them; explicit "remaining native step" comment. Low priority. |
| **CX-018** widget/app interpreter drift | **Confirmed, real divergence** | [WidgetNodeView.swift](../app/targets/widget/WidgetNodeView.swift): `color` has no hex (:200 vs NodeView:432), `styled` drops `monospacedDigit` (:125), `timerText` ignores `milliseconds` (:153). |
| CX-019 inspector rejection noise | Plausible | Periodic fetch unguarded; with my rejection tracker this now spams the overlay offline. Contained. |
| CX-020 examples don't match public path | Plausible (docs) | Not re-verified line-by-line. |
| **CX-021** fetch not WHATWG | **Partly — reframe** | Real that bodies re-read & non-http allowed. But don't chase full WHATWG on a watch. Keep the `fetch` name, **document the subset + allowlist `http(s)`**. |
| CX-022 native ops fail silently | Plausible, broad | A typed result/error channel is the right long-term shape; large. |
| CX-023 bridge not generated | Agree (refactor) | Real duplication ([JSRuntime.swift:359](../js/swift/Sources/ReactWatchRuntime/JSRuntime.swift)). Large. |
| CX-024 component contract duplicated | Agree (refactor) | Same root cause as CX-018; do the small extraction first. |
| CX-025 OTA version has two manual sources | Agree | Folds into CX-007's fix. |
| CX-026 intent files duplicated across targets | Plausible | [app/targets/watch/ShoppingIntent.swift] vs [app/targets/widget/ShoppingIntent.swift]. |
| CX-027 docs mix status/plans/claims | Agree | `roadmap.md`/`publishing.md`/READMEs disagree on what's "shipped". |
| **CX-028** OTA scripts need integration | **Already done** | My CR-17 work: committed, Biome-clean, `ota:keygen`/`ota:sign` scripts, `OTASigningInteropTests`, secret handling in [ota-signing.md](./ota-signing.md). They stay repo tooling (not in the npm `files`). |

---

## The OTA story (your top concern, in one place)

You said the thing you must not allow is *old JS running against a newer-schema
db*. The design already aims at that (hard gate + anti-rollback). Four wiring
gaps defeat it today, in priority order:

1. **The widget is ungated (CX-004) — the actual hole.** The app refuses to
   boot stale JS, but `IntentRuntime` unconditionally loads the binary's
   `bundle.qbc`/`bundle.js` and its intent handlers + `renderFreshTimelines`
   write the shared App Group store. So the instant the app is on OTA *vN*, the
   widget is still running *vN-old* code against the same db.
   **Fix:** one shared, version-aware, *verified* loader used by both
   processes. The extension must honor the same high-water + hard gate; when
   blocked it must render only the app-published static timelines and **never
   mutate storage**. The engine is already shared (`ReactWatchRuntime`), so this
   is wiring + a shared load policy, not a second implementation.

2. **A malformed key silently disables the gate (CX-003).** You opted into the
   hard gate to protect the db; a truncated/typo'd base64 key turns it off with
   just a log line. **Fix:** three explicit states — *absent* (dev fail-open,
   loud), *valid*, *invalid* (refuse to boot OTA, never fall through to
   unsigned). Tests for absent/valid/malformed/wrong-length.

3. **The bytecode cache can run stale code (OP-1 / CX-006).** Hash-key the
   bytecode to its source and make the apply atomic.

4. **Version is overloaded (CX-007 / CX-025).** Keep the monotonic integer as
   the *compatibility/rollback* gate (your "bump only on breaking" rule is right
   for that). Add a separate *release id* (content hash or build number) for "is
   this a different bundle," so non-breaking fixes actually ship. Have JS read
   native's active state instead of its own compile-time `BUNDLE_VERSION`, and
   make `applyUpdate` request/response (CX-005) so the UI can't claim success on
   a rejected update.

---

## Decisions (resolved 2026-06-25)

1. **Foundation Models (CX-002): fix it properly, keep it.** The owner pointed
   out FM is on watchOS — verified: **watchOS 27.0+ (beta)** via
   `SystemLanguageModel`. So: change the gate to `#available(watchOS 27.0, *)`,
   keep `#if canImport(FoundationModels)` so older-SDK builds still compile
   (feature simply unavailable), implement `maxTokens`
   (`GenerationOptions.maximumResponseTokens`), add a capability query
   (`SystemLanguageModel.default.availability`) so JS can detect availability,
   and document the watchOS-27-SDK build requirement. Private Cloud Compute
   (larger context) is a later enhancement, not required now.
2. **Widget-under-OTA (CX-004): shared verified loader.** One version-aware,
   signature-checked loader used by both app and widget; the widget honors the
   same high-water + hard gate and never mutates storage when blocked.
3. **Version model (CX-007): split gate + release id.** The monotonic integer
   stays the compatibility/rollback gate (bump only on breaking); add a separate
   release id (content hash or build number) for freshness; JS reads native's
   active state instead of compile-time `BUNDLE_VERSION`.
4. **fetch (CX-021): tighten toward WHATWG.** Add `clone`, body-used state,
   credentials/cache/redirect handling, and allowlist `http(s)` schemes. (Owner
   chose full compat over the smaller documented-subset option.)
5. **CI (CX-013): skip.** Conflicts with the standing disabled-Actions decision.

---

## Recommended execution plan

Phases are ordered by risk-reduction-per-effort. CX-013 is intentionally
excluded; CX-028 is done.

**Phase 0 — unblock publishing (hours).**
CX-001 (explicit `files` allowlist + `LICENSE` + `license` field) and CX-003
(fail-closed key). CX-002 (correct the gate to `watchOS 27.0`, implement
`maxTokens`, add a capability query) rides here too — but compiling/verifying
the Foundation Models branch needs the watchOS 27 SDK (Xcode 27 beta), so it can
land code-complete now and be device-verified when that SDK is in use.

**Phase 1 — runtime safety (contained, mostly mechanical).**
CX-009 (reject mismatched tree before mutating root/ack), CX-010 (guarantee an
ack in a `finally` + render handlerless controls read-only using the existing
`onChange:true` flag), CX-008 (generation token; cancel `fetchTasks`/sensors/BLE
on `boot`), CX-014 (sensor refcount), CX-019 (inspector rejection guard), plus
OP-2/OP-5/OP-6.

**Phase 2 — OTA coherence (your top concern).**
CX-004 (shared verified loader/gate), CX-005 (request/response `applyUpdate`),
CX-006+OP-1 (atomic apply + hash-keyed bytecode), CX-007+CX-025 (split version
vs. release id; expose native state to JS). Add fault-injection + the
shipped/valid/invalid/downgrade/missing-cache test matrix for *both* processes.

**Phase 3 — kill the interpreter-drift class.**
CX-018/CX-024 first move: extract the shared pure style helpers (hex color,
semantic font, value formatting, timer interval) into a small watchOS-only
shared module both `NodeView` and `WidgetNodeView` call, + one test enumerating
every primitive's app/widget support. Then CX-015 (Map region), CX-016
(snapshot ≤ now), CX-017 (relevantContexts or drop the claim) ride along.

**Phase 4 — make the consumer path real.**
CX-011 (reconcile plugin-owned files on option changes), CX-012 (own linking +
Info.plist or a documented prebuild executable), CX-020 (turn the Expo example
into a clean-room consumer that dogfoods the plugin).

**Phase 5 — maintainability.**
CX-021 (tighten fetch toward WHATWG — `clone`, body-used state,
credentials/cache/redirect, + allowlist `http(s)` schemes), CX-022 (typed native
result/error channel), CX-023 (generate the host bridge from the schema),
CX-026 (de-dup intent sources), CX-027 (split docs into verified-status vs.
roadmap, link "shipped" claims to test/build evidence).

---

## Validation done during this review

- Read in full: `JSRuntime.swift`, `NodeView.swift`, `renderer.ts`,
  `events.ts`, `serialize.ts`, `components.ts`, `update.ts`, `index.ts`,
  `widgets.ts`, `IntentRuntime.swift`, `ReactWidgets.swift`,
  `WidgetNodeView.swift`, `sensors.ts`, and the OTA/boot/fetch/generate paths of
  `ReactWatchHost.swift`.
- Skimmed: the Expo plugin, codegen, fetch.ts, package manifest.
- Did **not** independently deep-read: navigation.tsx, the BLE bridge, codegen
  internals, examples — CX items there are marked "plausible" above, not
  "confirmed."
- No code was changed by this review.
