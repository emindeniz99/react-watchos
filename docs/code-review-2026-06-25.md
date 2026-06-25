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

## Decision: PR #26 (`claude/rn-watchos-js-call-bridge`) — history merged, code reimplemented

We did **not** take PR #26's code wholesale (it supersedes the earlier #6 /
`claude/hopeful-volta-vigrf7`, now deleted). Every issue below — including the
eval-string → `JS_Call` bridge refactor (CR-5) and the orphaned doc-comment
(CR-2) — is solved **directly on `main`**.

**Done:** #26's 17-commit history is preserved in `main` via a
`git merge -s ours` (history only, tree unchanged — `main` had moved ~310
commits, so a real merge would be a large conflict), and the bridge was then
**re-implemented cleanly on `main` behind an A/B flag** (`useJSCallBridge`),
using #26's hardening as reference. The two paths are equivalent (same args),
switchable for on-device A/B comparison before the eval path is retired.

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

- [x] **CR-2 — Orphaned doc-comment in `JSRuntime.swift`.** `cosmetic`
  On `main`,
  [`JSRuntime.swift:138-142`](../js/swift/Sources/ReactWatchRuntime/JSRuntime.swift#L138)
  the `pushNativeEvent` doc block sits above `resolveFetch` (fused with
  the fetch comment); the real `pushNativeEvent` (line 155) has no doc.
  **Fix on main:** move the `pushNativeEvent` doc block down to its
  function and restore `resolveFetch`'s own comment — a ~4-line move.
  (PR #26's rewrite happens to fix this too, but we're not merging it.)
  **Done (2026-06-25):** moved the `pushNativeEvent` doc to `pushNativeEvent`;
  `resolveFetch` keeps only its own comment.

- [x] **CR-3 — `OptimisticTextField` doesn't use the optimistic store.**
  `P2`
  [`NodeView.swift:559`](../js/swift/Sources/ReactWatchHost/NodeView.swift#L559)
  Every other input control keeps its in-flight value in
  `model.optimistic` keyed by node id, "so it survives SwiftUI view
  identity changes mid-flight." TextField instead uses view-local
  `@State`, so a view-identity change while editing (e.g. a List reorder)
  resets the text. Likely tolerable because watch text entry is modal —
  **fix or document** the inconsistency inline next to the comment that
  promises the opposite.
  **Done (2026-06-25): fixed the React-Native way — controlled value.** Like
  RN's controlled `TextInput`, the displayed text now comes from the
  model-keyed optimistic store (`optimisticString`) falling back to the
  `value` prop, never view-local `@State` — so the in-flight edit is keyed by
  node id and survives a view-identity change, exactly like Toggle/Slider.
  watchOS text entry is modal (one commit when the input UI closes), so the
  binding's single `set` calls `dispatchOptimistic` and the entry clears on
  React's ack — no per-keystroke dispatch, and the `onChange` "fires on commit"
  contract is unchanged. Added `OptimisticStore.string` (Linux-tested) +
  `model.optimisticString`; the struct keeps its now-accurate
  `OptimisticTextField` name.

## Security

- [x] **CR-4 — OTA updates load unsigned remote JS.** `P1`
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
  **Done (2026-06-25): Ed25519 verification, fail-open + warn.** `applyUpdate`
  now carries an optional base64 signature; the host parses it via a pure
  `UpdatePlan` (Linux-tested) and, when `ReactWatchRootView(updatePublicKeyBase64:)`
  is configured, verifies the signature over the bundle bytes with CryptoKit
  **before persisting** (`saveUpdate`) — an unsigned or bad bundle
  is refused and the shipped bundle is used. *(CR-17 update: the original
  load-time re-verify was replaced by a "verify at save = network boundary,
  trust the local App Group sandbox" posture, which is what lets `load` run the
  on-device bytecode cache — see CR-17.)* Per the chosen posture, with **no
  key** configured it stays **fail-open**: the bundle loads but the native side
  logs a loud unverified-bundle warning, so a consumer must opt in to enforce.
  HTTPS is consumer-controlled (the consumer does the fetch) and documented in
  `update.ts`; the signature is the actual integrity/authenticity defense,
  strictly stronger than transport. Tested: `UpdatePlanTests` (Swift) +
  `update.ota.test.ts` (JS); host builds for the watchOS simulator.

- [x] **CR-5 — eval-string bridge is an injection-shaped pattern.** `P1`
  [`JSRuntime.swift:121-165`](../js/swift/Sources/ReactWatchRuntime/JSRuntime.swift#L121)
  `dispatchEvent`/`pushNativeEvent`/`resolveFetch` build JS source and
  `JS_Eval` it. Currently *safe* (every value goes through `jsStringLiteral`
  JSON-encoding) but per-call compiled and "code-from-runtime-data" shaped.
  **Fix on main:** re-implement the bridge with direct `JS_Call` on cached
  globals, behind the A/B flag (see Decision); the
  `claude/rn-watchos-js-call-bridge` branch is the reference. Also cover the
  **widget extension's** `evaluateBool`/`evaluateString`
  intent-dispatch path so the eval surface is gone consistently, not just
  on the watch app.
  **Done (2026-06-25):** all Swift→JS calls go through `bridgeCall`, gated by
  `useJSCallBridge` (default on). With the flag, `JS_Call` invokes the cached
  global function with `JSValue` args (no per-call parse, not injection-shaped);
  the legacy eval-string path stays as the other A/B arm. Covers
  `dispatchEvent` / `pushNativeEvent` / `resolveFetch` / `rejectFetch` /
  `resolveGenerate` / `rejectGenerate` / `__fireTimer`, **and** the widget
  intent path via `callReturningBool("__handleIntent",…)` /
  `callReturningString("__renderWidgets",…)` — so the eval surface is gone
  consistently. The `index.ts` payload contract is unchanged (args are the same
  numbers + JSON string the JS parses). #26's history is preserved via the
  `-s ours` merge (see Decision). A thrown JS exception routes to `onError`; a
  missing global is reported, not crashed. Tested: A/B equivalence for
  `dispatchEvent` + the widget return methods across *both* flag states, plus
  the missing-function path (`RuntimeSmokeTests`). 50 swift tests green; host
  builds for watchOS. **On-device A/B comparison before retiring the eval path
  remains the CR-14 gate.**

## Performance

- [x] **CR-6 — Unbounded fetch response into one bridged string; binary
  lost.** `P1`
  [`ReactWatchHost.swift:333`](../js/swift/Sources/ReactWatchHost/ReactWatchHost.swift#L333)
  The whole body is UTF-8-decoded into a `String` and crammed across the
  bridge with no size cap — on a memory-tight watch (and the widget's
  ~16 MB QuickJS cap) a large response can exhaust the heap. Binary
  responses silently become `""` (the `?? ""` fallback).
  **Fix:** reject loudly past a size limit; add a base64 path for binary.
  **Done (2026-06-25):** a pure `FetchResponse.classifyBody(data, maxBytes)`
  in `ReactWatchSupport` (Linux-tested) returns `.text` / `.base64` /
  `.tooLarge` (5 MiB default cap). The host rejects `.tooLarge` loudly and
  tags binary with `bodyEncoding: "base64"`. `fetch.ts` carries
  `bodyEncoding`, adds `arrayBuffer()` (base64-decode or a hand-rolled UTF-8
  encode — no `TextEncoder` in QuickJS), and makes `text()`/`json()` reject
  on binary instead of returning a silently-wrong value. Covered by
  `FetchBodyTests` (Swift) + `fetch.test.ts` (JS); verified on the watchOS
  simulator.

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

- [x] **CR-9 — `performance.now()` is `Date.now()`.** `P3`
  [`shims.ts:79`](../js/src/shims.ts#L79) — wall-clock, ms resolution, not
  monotonic; a clock adjustment can yield a negative delta. React's
  scheduler tolerates it. If quickjs-ng exposes a monotonic clock to the
  host, prefer it.
  **Done (2026-06-25): already preferred — clarified.** quickjs-ng ships a
  monotonic `performance.now()` (`JS_AddPerformance` → `js__hrtime_ns()` over
  `CLOCK_MONOTONIC`), and the shim only assigns when `performance` is
  *undefined* — so on the watch (and Node) the engine's monotonic clock is
  already used and the `Date.now()` branch is never taken. Documented that
  it's a last-resort fallback for a bare engine, the only case with no
  monotonic source.

- [x] **CR-10 — BLE characteristic lookup by raw JS string.** `P2`
  [`BluetoothBridge.swift:190-198`](../js/swift/Sources/ReactWatchHost/BluetoothBridge.swift#L190)
  indexes both `uuidString` and its lowercased form, but `write`/
  `subscribe` look up by exactly the string JS passed. CoreBluetooth
  collapses standard 128-bit UUIDs to their 16-bit short form, so a JS
  caller using the full 128-bit string can miss. Untested path (flagged in
  the file header). **Fix:** normalize via `makeCBUUID(...).uuidString`
  on both store and lookup.
  **Done (2026-06-25):** added a pure `BluetoothUUID.canonical(_:)` in
  `ReactWatchSupport` that expands 16/32-bit short UUIDs through the Bluetooth
  Base UUID to one uppercase 128-bit key. The bridge now stores characteristics
  *and* resolves `write`/`subscribe`/`desiredSubscriptions` through it, so
  short, full, and any-case forms all collide on the same key. Pulled into
  `ReactWatchSupport` so it's unit-tested on Linux/macOS (`BluetoothUUIDTests`)
  rather than only on a watch with a real peripheral — also chips at CR-15.
  (`onNotify` still reports the char's own short form, unchanged, to avoid
  breaking the common short-form consumer.)

## API / DX

- [x] **CR-11 — Color is a fixed allowlist; no hex/RGB.** `P3`
  [`NodeView.swift:404`](../js/swift/Sources/ReactWatchHost/NodeView.swift#L404)
  — 17 named SwiftUI colors. A `#rrggbb` fallback in `color(_:)` (~5
  lines) would unblock brand colors.
  **Done (2026-06-25):** `color(_:)`'s default now parses `#RRGGBB` /
  `#RRGGBBAA` (`hexColor`), so brand colors work beyond the named set; an
  unknown name still resolves to nil. Documented in `components.ts`.

- [x] **CR-12 — `DatePicker` mode is loosely matched.** `P3`
  [`NodeView.swift:353`](../js/swift/Sources/ReactWatchHost/NodeView.swift#L353)
  / [`components.ts:251`](../js/src/components.ts#L251) — `"dateAndTime"`
  and any typo both fall through `default` to date+time. Works; just no
  loud signal on a bad mode string.
  **Done (2026-06-25):** the three documented modes (incl. `dateAndTime` and
  `nil`) are now explicit cases; a genuinely-unknown mode still falls back to
  date+time but trips an `assertionFailure` (loud in DEBUG, no-op in release)
  instead of silently swallowing the typo.

- [x] **CR-13 — Multi-value response headers stringified as array
  description.** `P3`
  [`ReactWatchHost.swift:331`](../js/swift/Sources/ReactWatchHost/ReactWatchHost.swift#L331)
  — `"\(value)"` on `allHeaderFields` gives Swift's array description for
  repeated headers (e.g. `Set-Cookie`), not a WHATWG comma-join. Niche.
  **Done (2026-06-25):** an array-valued header is now `", "`-joined (WHATWG)
  instead of rendered as `"[a, b]"`; scalar headers are unchanged.

## Testing

- [ ] **CR-14 — Physical-device + signing path unverified.** `known gate`
  App Groups, `WKRunsIndependentlyOfCompanionApp` on hardware. The
  headline known gap (see roadmap). Tracked, not a regression.

- [x] **CR-15 — `BluetoothBridge` / `SensorBridge` are untested.** `P2`
  Both say so in their headers; they're the least-covered Swift, and the
  BLE auto-reconnect + pending-write-replay state is exactly what rots
  silently. **Fix:** `swift test` against a faked `CBCentralManager`-shaped
  protocol seam (Linux-runnable if abstracted).
  **Done (2026-06-25):** extracted the exact rot-prone state — the
  write-replay queue, the re-applied subscriptions, and the
  deliberate-vs-dropped disconnect latch — into a pure `BleSession` in
  `ReactWatchSupport`, now unit-tested off-device (`BleSessionTests`: replay
  order + replay-once, subscription persistence across a drop, user-disconnect
  drops everything and stays down). The bridge delegates state to it; the
  CoreBluetooth I/O is unchanged. (Also fixed a latent bug surfaced by the
  extraction: a user disconnect now drops queued writes too, not just
  subscriptions, so a stale command can't fire on the next connect.)
  `SensorBridge` is stateless command-dispatch + sensor→payload mapping with
  no rot-prone state to extract — its only risk is the HealthKit/CoreMotion
  integration, which stays under the device gate (CR-14).

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

---

## CR-17 — OTA versioning, anti-rollback & integrity (planned 2026-06-25)

Follow-up to **CR-4**, agreed in discussion. Goal: never silently run stale JS
after a downgrade or state loss, and never let an old/wrong-version bundle
corrupt the persisted db. Decisions: keep **Ed25519** (+ a `scheme` byte for
future agility); **3 MiB** cap; **monotonic-integer compatibility version**,
bumped *manually only on a breaking change* (db schema / wire contract) — so an
older bundle is refused and can't touch a newer-schema db; **hard gate opt-in**
(default soft) that *won't boot* stale JS so it can't write to the db;
**compile-on-get bytecode cache**; **remote freshness check** on launch.

Trust placement: enforcement in Swift (JS — incl. `update.ts` — is itself
OTA-replaceable); pure decision logic in `ReactWatchSupport` (tested); the
update popup is JS-driven via an `update.required`/`update.available` event.

- [x] **3 MiB size cap** — `saveUpdate` rejects an oversized bundle before
  persisting (the app parses the whole source through QuickJS at launch, so a
  multi-MB bundle risks an OOM kill). Done 2026-06-25.
- [x] **Manifest signing v2** — the signature now covers
  `"<scheme>:<version>:<js>"` (`UpdatePlan.signedMessage`), so the version is
  *inside* the signed bytes and can't be relabelled. Wire payload is
  `{js, version, signature}` (`applyUpdate(js, version?, signature?)`); the
  persisted sidecar is one `ota-meta.json` (`{version, signature}`). `saveUpdate`
  verifies over the signed message before persisting; `load` re-verifies over it
  before evaluating. Tested (`UpdatePlanTests` + `update.ota.test.ts`); host
  builds for watchOS. Done 2026-06-25.
- [x] **`VersionPolicy` (ReactWatchSupport, pure + tested)** — `accepts`
  (anti-rollback), `decide` → `runOTA | runShipped | blockForUpdate`, and a
  monotonic `bumpedHighWater`, plus the `OTAGate` enum. `VersionPolicyTests`
  green on macOS. Done 2026-06-25.
- [x] **High-water mark** — `SharedWidgetStore.otaHighWater` in the *same App
  Group as Storage* (shared fate with the db). `saveUpdate` refuses
  `version < highWater` (anti-rollback); `load` bumps it on a successful boot
  via `VersionPolicy.bumpedHighWater`, never decreasing. Done 2026-06-25.
- [x] **Hard-gate-blocks-boot** — config moved to `OTAConfig` (publicKey, gate,
  shippedVersion); `ReactWatchRootView(ota:)`. `load` runs `VersionPolicy.decide`:
  in `.hard` + stale state it sets `updateRequired` and shows a native
  `UpdateRequiredView` *without evaluating the old bundle*, so it can't write to
  a newer-schema db. (Fail-open keeps the simple OTA-if-present path; versions
  are unverified there.) Native re-fetch recovery lands with the remote check.
  45 swift tests green; host builds for watchOS. Done 2026-06-25.
- [x] **Compile-on-get bytecode cache** — `JSRuntime.compileToBytecode`
  (`JS_Eval` COMPILE_ONLY + `JS_WriteObject`, via two shim wrappers). On a
  verified save the source is compiled (in a throwaway runtime, so it's
  version-matched) and cached as `ota-bundle.qbc`; `load` prefers the cache and
  falls back to parsing source if it's missing/stale (engine changed). **Threat
  model refined:** the signature is verified at *save* (the network boundary)
  and the App Group is a trusted local sandbox, so `load` no longer re-verifies
  — which is what lets it run the unsigned local bytecode (standard CodePush/EAS
  posture). Round-trip + bad-source tests in `RuntimeSmokeTests`; 45 + 7 green;
  host builds for watchOS. Done 2026-06-25.
- [x] **Remote freshness check** — manifest `GET <updateUrl>` →
  `{version, bundle, signature}` (emitted by `build.mjs` into `dist/`, served by
  the existing dev server). **JS/soft path:** `checkForUpdate` /
  `fetchAndApplyUpdate` (the demo's OTA screen uses them). **Native hard path:**
  `OTAConfig.manifestURL` + `model.checkForUpdateNatively()` re-fetches the
  manifest+bundle, stages it through the verified `saveUpdate` gate, and reboots
  — so a hard-gated, JS-not-running device recovers from `UpdateRequiredView`'s
  "Check for update" button (covers the lost-OTA / reinstall case). 47 swift +
  189 JS tests green; host builds for watchOS. Done 2026-06-25.

Sequencing: OTA core (cap → manifest v2 → VersionPolicy → high-water → hard
gate) → compile-cache → remote check → then **CR-5** (`-s ours` merge of #26 +
clean A/B-flagged rewrite). Deferred (measure-first): **core/app bundle split**.
