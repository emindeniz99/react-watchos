# Code review — 2026-06-25

A full read-through review of `react-native-watchos`: the JS reconciler
and bridge, the serializer, the Swift runtime/host/SwiftUI interpreter,
the native bridges (BLE, sensors), the codegen wire contract, and the
Expo config plugin.

- **Date:** 2026-06-25
- **Reviewed at:** `main` @ `7924c67`
- **Reviewer:** Claude (Opus 4.8), read-only pass — nothing built on a
  Mac, so SwiftUI-touching findings are inferred from source, not from a
  device run (the macOS build gate still applies — see
  [roadmap.md](./roadmap.md)).
- **Status:** backlog. Each item below has a stable id (`CR-n`) and a
  checkbox; we fix them one at a time and tick them off here.

## Verdict

Coherent, senior-level architecture (custom `react-reconciler` host
config → full-tree JSON commits → SwiftUI interpreter), a wire contract
generated from one schema so JS and Swift can't drift, a deliberate
threading model (`@MainActor` model + off-main decode queue), and a
genuine "fail loud" ethos in several places. The items below are
refinement, not rework. The highest-value standalone fix is **CR-1**
(async JS errors are silently swallowed).

## Decision: PR #26 (`claude/rn-watchos-js-call-bridge`) will NOT be merged

We are **not merging** the open `JS_Call` bridge branch (PR #26
supersedes the earlier #6 / `claude/hopeful-volta-vigrf7`, now deleted).
Every issue below — including the eval-string → `JS_Call` bridge refactor
(CR-5) and the orphaned doc-comment (CR-2) — is solved **directly on
`main`**. The `claude/rn-watchos-js-call-bridge` branch is kept only as a
reference implementation for the bridge work.

Plan:

1. First fix the standalone issues below (CR-1, CR-4, CR-6, CR-8…) so
   `main` is clean on its own merits.
2. Then re-implement the eval-string → `JS_Call` bridge on `main`
   **behind an A/B feature flag** (CR-5), so the old and new paths can be
   compared on-device before the old one is removed. The refactor is
   broad (Swift bridge + the `index.ts` payload contract) and the worry
   is regressions that only surface on a real watch — the flag de-risks
   that.

---

## Correctness

- [x] **CR-1 — `drainJobs()` silently swallows async JS errors.** `P0`
  [`JSRuntime.swift:284`](../js/swift/Sources/ReactWatchRuntime/JSRuntime.swift#L284)
  ```swift
  while JS_ExecutePendingJob(runtime, &ctx) > 0 {}
  ```
  `JS_ExecutePendingJob` returns `-1` when a job throws, leaving the
  exception on the context — the loop exits on `≤ 0` without reading it.
  So any unhandled promise rejection or error in a microtask vanishes: a
  `fetch().then()` that throws, an async handler, a rejected
  `generateText`. This contradicts the project's loud-failure principle.
  Synchronous paths are covered (`evaluateReportingErrors`,
  `WatchRoot.flush()` rethrow); the async hole is not.
  **Fix:** check for `< 0`, route `takeExceptionMessage()` to `onError`,
  and/or install `JS_SetHostPromiseRejectionTracker`. Independent of PR #26.
  **Done (2026-06-25):** `drainJobs()` now reports the `< 0` (a job threw)
  return and keeps draining; *and* `JS_SetHostPromiseRejectionTracker` was
  installed, because a bare unhandled rejection (rejected `fetch`/
  `generateText`) never throws at the job level — it only notifies the
  tracker. Both halves were needed. Covered by **CR-16**.

- [ ] **CR-2 — Orphaned doc-comment in `JSRuntime.swift`.** `cosmetic`
  On `main`,
  [`JSRuntime.swift:138-142`](../js/swift/Sources/ReactWatchRuntime/JSRuntime.swift#L138)
  the `pushNativeEvent` doc block sits above `resolveFetch` (fused with
  the fetch comment); the real `pushNativeEvent` (line 155) has no doc.
  **Fix on main:** move the `pushNativeEvent` doc block down to its
  function and restore `resolveFetch`'s own comment — a ~4-line move.
  (PR #26's rewrite happens to fix this too, but we're not merging it.)

- [ ] **CR-3 — `OptimisticTextField` doesn't use the optimistic store.**
  `P2`
  [`NodeView.swift:559`](../js/swift/Sources/ReactWatchHost/NodeView.swift#L559)
  Every other input control keeps its in-flight value in
  `model.optimistic` keyed by node id, "so it survives SwiftUI view
  identity changes mid-flight." TextField instead uses view-local
  `@State`, so a view-identity change while editing (e.g. a List reorder)
  resets the text. Likely tolerable because watch text entry is modal —
  **fix or document** the inconsistency inline next to the comment that
  promises the opposite.

## Security

- [ ] **CR-4 — OTA updates load unsigned remote JS.** `P1`
  [`update.ts`](../js/src/update.ts) +
  [`ReactWatchHost.swift:114`](../js/swift/Sources/ReactWatchHost/ReactWatchHost.swift#L114)
  (`saveUpdate`) /
  [`:158`](../js/swift/Sources/ReactWatchHost/ReactWatchHost.swift#L158)
  (`load`). The consumer fetches a bundle and `applyUpdate(text)` persists
  it; next launch evals it with no integrity check. The fixed native host
  surface caps the blast radius (no new native APIs), but arbitrary OTA JS
  still inherits everything already exposed: `Storage`, `sendToPhone`,
  BLE, location/heart-rate sensors, notifications, and `fetch` anywhere.
  Plain-`http` or a compromised origin ⇒ silent in-sandbox RCE on the
  watch.
  **Fix:** sign the bundle (e.g. Ed25519 over the bytes, public key in the
  native binary) and verify in `saveUpdate`/`load` before persisting;
  refuse non-HTTPS. Standard CodePush-style mitigation.

- [ ] **CR-5 — eval-string bridge is an injection-shaped pattern.** `P1`
  [`JSRuntime.swift:121-165`](../js/swift/Sources/ReactWatchRuntime/JSRuntime.swift#L121)
  `dispatchEvent`/`pushNativeEvent`/`resolveFetch` build JS source and
  `JS_Eval` it. Currently *safe* (every value goes through `jsStringLiteral`
  JSON-encoding) but per-call compiled and "code-from-runtime-data" shaped.
  **Fix on main:** re-implement the bridge with direct `JS_Call` on cached
  globals, behind the A/B flag (see Decision); the
  `claude/rn-watchos-js-call-bridge` branch is the reference. Also cover the
  **widget extension's** `evaluateBool`/`evaluateString`
  ([`:169`](../js/swift/Sources/ReactWatchRuntime/JSRuntime.swift#L169),
  [`:184`](../js/swift/Sources/ReactWatchRuntime/JSRuntime.swift#L184))
  intent-dispatch path so the eval surface is gone consistently, not just
  on the watch app.

## Performance

- [ ] **CR-6 — Unbounded fetch response into one bridged string; binary
  lost.** `P1`
  [`ReactWatchHost.swift:333`](../js/swift/Sources/ReactWatchHost/ReactWatchHost.swift#L333)
  The whole body is UTF-8-decoded into a `String` and crammed across the
  bridge with no size cap — on a memory-tight watch (and the widget's
  ~16 MB QuickJS cap) a large response can exhaust the heap. Binary
  responses silently become `""` (the `?? ""` fallback).
  **Fix:** reject loudly past a size limit; add a base64 path for binary.

- [ ] **CR-7 — Per-commit full serialize + string-compare dedup.**
  `accepted, no action`
  [`renderer.ts:223-237`](../js/src/renderer.ts#L223). Every commit
  re-serializes the whole tree and string-compares to `lastCommitJson`.
  Documented as fine for watch-sized trees; React-Compiler memoization
  reduces commit count; tree-diff measured and dropped (see roadmap). Kept
  here only as the known scaling edge (large `<List>`s). Leave as-is.

## Robustness / error handling

- [x] **CR-8 — `console` shim is incomplete.** `P2`
  [`shims.ts:72-76`](../js/src/shims.ts#L72) wires only
  `log/info/warn/error`. `console.debug/assert/group/table/dir` are
  `undefined` and throw in QuickJS — libraries and React dev builds call
  them. **Fix:** alias `debug`→`log` etc.; no-op the rest. Small.
  **Done (2026-06-25):** printing methods (debug/trace/dir/group/
  groupCollapsed/table) alias to the host log, `assert` logs only when
  falsy, structural/measurement methods (groupEnd/count/time…) no-op.
  Regression test in `shims.test.ts` (driven with `console` deleted).

- [ ] **CR-9 — `performance.now()` is `Date.now()`.** `P3`
  [`shims.ts:79`](../js/src/shims.ts#L79) — wall-clock, ms resolution, not
  monotonic; a clock adjustment can yield a negative delta. React's
  scheduler tolerates it. If quickjs-ng exposes a monotonic clock to the
  host, prefer it.

- [ ] **CR-10 — BLE characteristic lookup by raw JS string.** `P2`
  [`BluetoothBridge.swift:190-198`](../js/swift/Sources/ReactWatchHost/BluetoothBridge.swift#L190)
  indexes both `uuidString` and its lowercased form, but `write`/
  `subscribe` look up by exactly the string JS passed. CoreBluetooth
  collapses standard 128-bit UUIDs to their 16-bit short form, so a JS
  caller using the full 128-bit string can miss. Untested path (flagged in
  the file header). **Fix:** normalize via `makeCBUUID(...).uuidString`
  on both store and lookup.

## API / DX

- [ ] **CR-11 — Color is a fixed allowlist; no hex/RGB.** `P3`
  [`NodeView.swift:404`](../js/swift/Sources/ReactWatchHost/NodeView.swift#L404)
  — 17 named SwiftUI colors. A `#rrggbb` fallback in `color(_:)` (~5
  lines) would unblock brand colors.

- [ ] **CR-12 — `DatePicker` mode is loosely matched.** `P3`
  [`NodeView.swift:353`](../js/swift/Sources/ReactWatchHost/NodeView.swift#L353)
  / [`components.ts:251`](../js/src/components.ts#L251) — `"dateAndTime"`
  and any typo both fall through `default` to date+time. Works; just no
  loud signal on a bad mode string.

- [ ] **CR-13 — Multi-value response headers stringified as array
  description.** `P3`
  [`ReactWatchHost.swift:331`](../js/swift/Sources/ReactWatchHost/ReactWatchHost.swift#L331)
  — `"\(value)"` on `allHeaderFields` gives Swift's array description for
  repeated headers (e.g. `Set-Cookie`), not a WHATWG comma-join. Niche.

## Testing

- [ ] **CR-14 — Physical-device + signing path unverified.** `known gate`
  App Groups, `WKRunsIndependentlyOfCompanionApp` on hardware. The
  headline known gap (see roadmap). Tracked, not a regression.

- [ ] **CR-15 — `BluetoothBridge` / `SensorBridge` are untested.** `P2`
  Both say so in their headers; they're the least-covered Swift, and the
  BLE auto-reconnect + pending-write-replay state is exactly what rots
  silently. **Fix:** `swift test` against a faked `CBCentralManager`-shaped
  protocol seam (Linux-runnable if abstracted).

- [x] **CR-16 — Add a test for async-error surfacing.** `P2`
  Once CR-1 lands, pin that a throwing microtask / rejected promise
  reaches `onError` (currently nothing surfaces it, so nothing tests it).
  **Done (2026-06-25):** landed with CR-1 in `RuntimeSmokeTests` — a
  throwing `queueMicrotask` (drain path) and an unhandled `Promise.reject`
  (tracker path) both reach `onError`, and a rejection caught while pending
  does *not* (guards the tracker against false positives). Verified on the
  watchOS simulator (`xcodebuild test -scheme ReactWatchHost-Package`).

---

## Suggested fix order

1. **CR-1** — async error swallow (highest value, standalone).
2. **CR-8** — `console` shim (tiny, removes a real crash class).
3. **CR-6** — fetch size cap + binary handling (prevents watch OOM).
4. **CR-4** — sign OTA bundles (the one genuine security exposure).
5. **CR-3 / CR-10 / CR-15** — TextField consistency, BLE lookup, bridge
   tests.
6. **CR-11 / CR-12 / CR-13 / CR-9** — DX polish.
7. Then re-implement the **`JS_Call` bridge on `main`** behind the A/B
   flag (CR-5); the CR-2 doc-comment falls out of that same area.

See [roadmap.md](./roadmap.md) for the forward feature plan; this file is
the correctness/cleanup backlog from the 2026-06-25 pass.
