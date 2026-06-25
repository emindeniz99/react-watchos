# System design review — Claude Opus — 2026-06-25 18:24 +03

A higher-altitude pass than the two issue backlogs. This looks at the
**architecture**: the protocol, the bridge, module boundaries, the data model,
OTA as a subsystem, codegen, threading, and the resource/security model — and
gives opinionated feedback with breaking changes on the table.

- **Reviewed:** `main` @ `b009ab7`, read-only.
- **Companion to:** the merged issue backlog
  ([code-review-2026-06-25-1817-merged.md](./code-review-2026-06-25-1817-merged.md)).
  Where a *design* change subsumes backlog items I say so. New design-level
  findings are tagged **SD-#**.
- **One-line verdict:** the architecture is genuinely good and the bones are
  right. The two structural weaknesses worth a deliberate decision are
  **(1) two hand-written interpreters of one wire tree** and **(2) the system
  versions code but never versions or migrates data** — the latter is the real
  root of your "old JS must not corrupt the db" fear, bigger than any single
  backlog item.

---

## How the system is shaped (the model in one paragraph)

React runs in QuickJS on the watch. A custom reconciler turns the element tree
into a serialized JSON tree; on every commit the whole tree (deduped) crosses
the `__host` C bridge as a string; a Swift SwiftUI interpreter (`NodeView`)
walks it into views. Interactions go back as `__dispatchEvent(nodeId, event,
payload, seq)`; the committed tree carries `seq` as an ack, which drives an
optimistic-input store. Native capabilities (`fetch`, BLE, sensors, haptics,
notifications, WatchConnectivity, AI, OTA) hang off `__host.*`. Widgets are
rendered by the *same* React, published as timelines to App Group storage, and
re-rendered natively by a *second* interpreter in the widget extension. OTA
swaps the JS bundle. A schema file generates the wire structs for both sides.

This is the right model for the goal (JS-driven UI, thin native layer). My
feedback is about the seams.

---

## Dimension-by-dimension feedback

### 1. Layering: JS authors, native interprets — **keep**
**Now:** clean separation; native is a thin binding layer (matches the project's
stated principle). **Feedback:** correct and rare to get this clean. The only
structural cost is that the interpreter is a hand-written `switch` that must
mirror the JS component set — see #4. No change to the model.

### 2. Wire protocol: full-tree-per-commit + seq/ack — **keep, name the ceiling**
**Now:** every commit serializes the *entire* tree to JSON, dedupes against the
last string ([renderer.ts:231](../js/src/renderer.ts)), and ships it; `seq` in
the payload doubles as the ack. **Feedback:** simple, debuggable, and the dedup
+ optimistic-ack design is elegant. But it's **O(tree) per commit** (serialize →
JSON → bridge → decode → SwiftUI diff), and navigation eagerly mounts *every*
route at all times ([navigation.tsx:260](../js/src/navigation.tsx), documented),
so a large multi-screen app pays full-tree cost on each commit and runs all
screens' mount effects at launch. For watch-sized UIs this is fine.
**Recommendation:** keep it; **document the scaling ceiling** and the eager-mount
tradeoff as explicit design limits. Only move to a patch/diff protocol if a real
app hits it. (Gap: there's no structured "JS render failed" channel back to
native beyond an `onError` string — fine for now.)

### 3. The bridge: one transport, **three ad-hoc call shapes** — **unify (SD-1)**
**Now:** JSON strings over the C ABI (pragmatic, correct). But the call
*semantics* are inconsistent across [host.ts:40](../js/src/host.ts):
- **sync return:** `getItem`
- **fire-and-forget:** `setItem`, `playHaptic`, `scheduleNotification`,
  `sendToPhone`, `ble`, `sensor`, `saveUpdate`, `publishWidgets`
- **request/response by id:** `fetch`, `generate`
- **push by name:** `__pushNativeEvent` (sensors, BLE state, connectivity, openURL)

**Feedback:** the JSON-string choice is right (don't marshal typed structs across
C). But the *fire-and-forget* class means any of those ops that can fail has
**nowhere to report failure** — this is the real root of CX-022 (silent native
failures) and CX-005 (`applyUpdate` can't be rejected). It's an architectural
gap, not eight separate bugs. **SD-1 / recommendation:** define one **typed
command channel** — `request(id, kind, payloadJson)` → correlated
`resolve/reject(id, resultJson)` — for everything that can fail (storage write,
BLE op, notification permission, OTA save). Keep the push channel for streams.
Subsumes **CX-005, CX-022**. Breaking on the internal bridge; JS API stays
mostly stable.

### 4. The dual interpreter — **the biggest structural smell (SD-2)**
**Now:** `NodeView` (app) and `WidgetNodeView` (widget) are **two independent
hand-written switches** over the same wire tree, plus a third partial degrade in
the widget. They already diverge (hex color, `monospacedDigit`, timer-ms — CX-018).
**Feedback:** this is the single change with the most leverage. Two interpreters
of one protocol *will* drift forever; every new primitive needs two edits and a
manual support decision. The codebase even states the goal ("one implementation,
not two") for the engine — the interpreter violates it. **SD-2 / recommendation:**
extract **one shared SwiftUI interpreter module** (watchOS-only, consumed by both
the app and the widget extension) with an explicit `interactive: Bool` /
`context: .app | .widget` mode rather than two switches; pure prop parsing
(color/font/format/timer) moves to `ReactWatchSupport`. Subsumes
**CX-015, CX-016, CX-017, CX-018, CX-024**, and shrinks the untested surface (#11).

### 5. Data model & native-capability compatibility (SD-3)

> **Refined 2026-06-25 (owner):** there's no DB, so "data migration" was the
> wrong frame. The live risk is a **new OTA bundle calling a native capability
> the installed binary lacks** (`fetchX` → crash). SD-3 is therefore a
> **two-sided native-capability gate** — upper `minHostApi ≤
> native.hostApiVersion` (→ "update the app"), lower `releaseId ≥ highWater`
> (downgrade blocked) — *not* data migration. Authoritative plan: the merged
> backlog's "Architecture decisions → SD-3". The notes below stand as secondary
> data-hygiene points for if a real persistent store ever appears.

**Now:** `Storage` is namespaced KV over App Group `UserDefaults`
([storage.ts](../js/src/storage.ts), [SharedWidgetStore.swift](../js/swift/Sources/ReactWatchSupport/SharedWidgetStore.swift));
both the app and the widget read/write it. **Feedback — this is the important
one.** Three structural issues:
1. **No data-schema version and no migration concept at all.** OTA versions the
   *code*; nothing versions or migrates the *data*. Your fear ("old JS corrupts
   the new-schema db") is fundamentally a *data*-versioning problem, and the
   system has no answer to it — the OTA version gate (CX-007) and the widget gate
   (CX-004) are partial mitigations around a missing concept.
2. **Two uncoordinated writers** (app + widget) → last-writer-wins; UserDefaults
   isn't transactional across keys, so a multi-key update can be observed
   half-applied by the other process.
3. **UserDefaults isn't a blob store** — the whole widgets payload lives in one
   JSON key; fine now, but it's not a durable document store.

**SD-3 / recommendation:** introduce an explicit **JS-owned data-schema version +
migration hook**, gated by the OTA compatibility integer (reuse it — see #6).
On boot, JS migrates data forward or refuses; the widget becomes a
**reader-by-default** and only mutates through a coordinated, versioned path.
This is the *system-level* answer to the db-corruption concern. Connects to
**CX-004, CX-007**.

### 6. OTA: good bones, but **conflates three concerns (SD-4)**
**Now:** sign-at-save + anti-rollback high-water + hard gate + bytecode cache,
across two processes. **Feedback:** the security model is well-articulated. The
design flaw is that **one integer carries three jobs** — integrity is the
signature, but *compatibility* (can this bundle run against the current data?)
and *freshness* (is this a newer build?) are both crammed into `version`. That's
why "bump only on breaking" breaks freshness (CX-007), and why the widget — not
modeled in the OTA state machine at all — can run stale code (CX-004).
**SD-4 / recommendation:** model OTA as **one explicit state machine with a
single active-bundle record** `{id, releaseId, compatVersion, hash, signature}`
shared by both processes; separate **integrity / compatibility / freshness**.
The *compatibility* number is the **data-schema version** from SD-3 (one source),
not a separate "breaking" counter. Subsumes **CX-004, CX-005, CX-006, CX-007,
CX-025**.

### 7. Threading: single-thread-on-main — **correct, two risks (SD-5)**
**Now:** QuickJS is single-threaded on the main thread; JSON decode hops to a
`decodeQueue`; URLSession completions hop back to main to settle. **Feedback:**
the single-threaded model is the right call (no JS locking). Two risks: (a) the
main thread runs *both* JS execution and SwiftUI, so a heavy render / large body
parse / OTA compile **blocks the UI** (the OTA compile already uses a throwaway
runtime — good); (b) nothing enforces the main-thread contract (OP-2), and reload
doesn't fence stale async (CX-008). **SD-5 / recommendation:** short-term, assert
the thread (OP-2) + generation token (CX-008). Longer-term *option to consider*:
move JS to a dedicated serial queue with explicit main hops only for SwiftUI
state, so JS work never janks the watch UI — bigger change, flag it, don't do it
speculatively.

### 8. Codegen / single source of truth — **half-done; finish it (SD-6)**
**Now:** the schema generates wire structs for both sides + a `hostMethods`
*manifest that a test checks* ([schema.mjs](../js/codegen/schema.mjs)).
**Feedback:** great direction, but the two un-generated halves — the **bridge
implementation** (install table, C trampolines, TS types) and the **component
contract** (primitives, props, events, app/widget support) — are *exactly* where
drift lives (CX-018/023/024). **SD-6 / recommendation:** make the schema the
authority for all three: wire structs (done), bridge surface (generate from the
manifest you already have), and the primitive contract. One source → the drift
class disappears. Subsumes **CX-023, CX-024**, supports **SD-1, SD-2**.

### 9. Security / threat model — **sound, one hole**
**Now:** sign at the network boundary, trust the local sandbox at load, host
surface fixed in the binary (OTA can't add native capability — good, and the
right App Store posture). **Feedback:** the only hole is fail-open on a malformed
key (CX-003). **Recommendation:** fail-closed default for production; the SD-3
data-schema gate closes the "old code, new data" path that signing alone can't.

### 10. Testing strategy — **strong split, named gap**
**Now:** pure logic in `ReactWatchSupport`/`Core` is Linux-tested; contract tests
cross-check wire + host manifest; the two interpreters and native bridges are
**only** manually built in Xcode. **Feedback:** the pure/impure boundary is a
genuinely good testability design. **Recommendation:** the SD-2 shared
interpreter + a **golden-tree contract test** (one tree → expected support per
primitive per context) converts most of the untested surface into a Linux/host
test. Pairs with SD-6.

### 11. Resource model — **appropriate; cap the app heap**
**Now:** bytecode cache for cold start (good), full-tree commits (#2), widget
capped at 16 MB, **app uncapped** (OP-3), 50 ms `TimerText` tick. **Feedback:**
mostly right for the watch. **Recommendation:** cap the app heap (OP-3); keep an
eye on full-tree cost if apps grow (#2).

### 12. Demo/app-target boundary — **app-specific code is duplicated (minor)**
**Now:** `ShoppingIntent.swift` is **identical** in the watch and widget targets
(CX-026); app-specific intent/storage constants are copied. **Feedback:** a
smaller instance of the same "two copies of one thing" theme. **Recommendation:**
one app-specific shared product (CX-026); generate/share the constants.

---

## The design decisions worth making (beyond the backlog)

| SD | Decision | Why it matters | Subsumes |
|----|----------|----------------|----------|
| **SD-3** | **Native-capability gate** — upper (`minHostApi ≤ native`) + lower (anti-rollback) *(refined: not data migration; no DB exists)* | Fixes new-JS-on-old-binary (`fetchX` crash) + downgrade block | CX-004, CX-007 |
| **SD-2** | **One shared SwiftUI interpreter** for app + widget | Kills the perpetual drift between two hand-written switches | CX-015/016/017/018/024 |
| **SD-4** | OTA = one state machine; separate integrity / compatibility / freshness; compat == data-schema version | Untangles the overloaded `version`; brings the widget into the model | CX-004/005/006/007/025 |
| **SD-1** | One **typed command/result channel** for fallible native ops | Failures stop vanishing; `applyUpdate`/storage/BLE/perm become observable | CX-005, CX-022 |
| **SD-6** | Make the **schema** the single source for wire + bridge + component contract | Removes the structural cause of drift | CX-023, CX-024 |
| **SD-5** | Enforce + (optionally) isolate the JS thread | Safety now (assert + generation token); UI-jank insurance later | CX-008, OP-2 |

These are **architecture** calls — larger than the backlog items, and several
backlog items are just *symptoms* of them. My recommended sequencing if you take
the system view:

1. **SD-3 + SD-4 together** (capability gate + OTA state machine) — your top
   concern, the same design problem. Do them as one piece; it absorbs the whole
   Phase-2 OTA cluster.
2. **SD-2** (shared interpreter) — highest leverage on long-term maintainability;
   absorbs the Phase-3 drift cluster.
3. **SD-1 + SD-6** (typed bridge + finish codegen) — do together; SD-6 makes SD-1
   cheap to express.
4. **SD-5** safety bits land opportunistically with Phase 1.

The fast publish-blockers (CX-001, CX-003, CX-002) are orthogonal to all of this
and still go first.

---

## What I'd explicitly *not* change

- The JS-authors / native-interprets model (#1) — it's the project's thesis and
  it's sound.
- JSON-strings-over-C (#3) — correct; don't marshal typed structs across the ABI.
- Single-threaded QuickJS (#7) — right call; only *isolate* the queue if UI jank
  ever shows up, never speculatively.
- Full-tree commits (#2) — keep until a real app proves the ceiling.

## Caveats on this review

- Architecture-level; I did not re-verify every line. Backlog items keep their
  per-line evidence in the merged doc.
- The SD recommendations are **directional**; each deserves its own short design
  note before implementation (especially the SD-3 gate semantics and SD-4 state
  machine), since they touch the App Store update posture and anti-rollback.
