# Merged & verified backlog — react-native-watchos — 2026-06-25 18:17 +03

One consolidated list from the two full reviews, ordered by **what to do first**
(importance × effort × your decisions). This is the list to work from; the
source reviews stay for detail.

- **Merges:** [Codex CX-001…CX-028](./code-review-2026-06-25-1735-codex.md) +
  [Opus OP-1…OP-6 and reconciliation](./code-review-2026-06-25-opus.md).
- **Verified at:** `main` @ `bec1772`. I re-read the code for **every** item
  below and recorded a verdict — including the ones I'd earlier only called
  "plausible." Evidence is `file:line`.
- **Decisions baked in** (yours, 2026-06-25): CX-002 fix-and-keep, CX-004 shared
  verified loader, CX-007 split gate+release-id, CX-021 tighten fetch to WHATWG,
  CX-013 skip.

## Build progress (live — updated each loop iteration)

Working through this autonomously (`/loop`). **Strategy:** bank
fully-`pnpm test`/`swift test`-verifiable wins that are *orthogonal* to the
foundation (zero rework) first, then do the foundation's verifiable parts
deliberately; watchOS-host-only changes (UI/`ReactWatchHost`) get flagged for
on-device (Xcode) verification rather than ground out blind. Done-ness is also in
`git log` (one commit per item).

Verifiable in-loop (Linux/macOS): JS (`pnpm test`) + `ReactWatchRuntime`/`Support`
(`swift test`). NOT in-loop: `ReactWatchHost`/widget UI, target wiring (Xcode).

- [x] **CX-001** — npm `files` allowlist + MIT LICENSE. `npm pack` 293 MB → 0.55 MB / 88 files.
- [x] **CX-014** — sensor streams reference-counted (start 0→1, stop 1→0; idempotent cleanup). +3 tests, suite 192 green.
- [x] **CX-019** — inspector poll `.catch` + stop/restart (`stopInspector`). +1 test, suite 193 green.
- [x] **OP-5** — `describe()` reads `.stack` only for real Errors (no bogus "undefined" for primitive rejections). +1 test, `swift test` 52 green.
- [x] **OP-4** — int args cross as `JS_NewInt64` (nodeId/seq beyond 2^31 no longer truncated). +1 test, `swift test` 53 green.
- [x] **CX-010 — done (both halves).** JS: `dispatchEvent` always acks the seq in a `finally` (handlerless / unknown node / throwing handler can't strand or skip-rollback an optimistic control), +3 tests. Host: `NodeView` disables a controlled input whose `onChange:true` wire flag is absent, so it can't show a value React will never accept. Verified on watchOS build.
- [~] **Foundation: ARCH-01** — feature manifest (in progress):
  - [x] slice 1 — `bridgeProtocol` structural version + per-method `feature`/`since` in `schema.mjs`, emitted by codegen (`HOST_METHODS` carries feature/since, `BRIDGE_PROTOCOL`, `RNWire.bridgeProtocol`). Drift clean, suite 196 + `swift test` 53 green.
  - [x] slice 2 — per-target feature sets generated (`HostFeatures.watch`/`.widget`, widget = strict subset) + pure `CapabilityGate.decide` (subset + bridge-protocol floor) in Support. +4 tests, `swift test` 57 green. (Generating the full Swift install *table* = CX-023, deferred — install stays hand-written, the cross-check test still guards it.)
  - [x] slice 3 — capability gate wired end-to-end. JS: `UpdateManifest` gains `requiredFeatures`/`minBridgeProtocol`; `checkForUpdate`/`fetchAndApplyUpdate` gate BEFORE download against `globalThis.__hostFeatures` (→ `appUpdateRequired`, no download/crash), +3 tests. Native: `ReactWatchHost` injects `__hostFeatures` (= `HostFeatures.watch`) + `__bridgeProtocol` at boot, **and `saveUpdate` enforces `CapabilityGate`** (UpdatePlan carries `requiredFeatures`/`minBridgeProtocol`; an incompatible bundle is refused even if signed — defense-in-depth behind the JS pre-download gate). +2 UpdatePlan tests; swift 69, watchOS build, JS 199 all green. **ARCH-01 complete.** Only ARCH-02 (build-time derivation of a bundle's `requiredFeatures`) remains as a separate item.
- [ ] **Foundation** ARCH-01 (feature manifest schema/codegen — verifiable) → ARCH-03 (app/widget bundles) → ARCH-04 (transactional OTA); absorbs CX-002/CX-003/CX-004/CX-007
- [x] **SD-2 / CX-018 — interpreter drift fixed** (shared-parsing approach):
  - [x] slice 1 — pure style helpers in Support (`RNStyle`: hex color → rgba, semantic font, value/timer formatting). +6 tests, `swift test` 63 green.
  - [x] slice 2a — `NodeView` resolves color/font/format via `RNStyle` (deleted duplicate `hexColor`). Verified: `xcodebuild -scheme ReactWatchHost -destination watchOS Sim` = BUILD SUCCEEDED.
  - [x] slice 2b — `WidgetNodeView` resolves via `RNStyle` too → **gains hex colors + monospacedDigit** (the actual CX-018 drift). Verified: `xcodebuild -scheme "React Watch Widgets"` = BUILD SUCCEEDED.
  - Note: full one-file unification (RenderContext/adapter, ARCH-10) is a further optional refactor; the drift itself is gone since both interpreters share `RNStyle`. (timer-ms stays intentionally degraded in widgets — WidgetKit can't tick at 50ms.)
- [x] CX-016 — pure `WidgetSnapshot.currentIndex` (latest entry ≤ now, else earliest) in Support (+4 tests, `swift test` 67); `ReactTimelineProvider.latestEntry` now uses it instead of `.entries.last`. Verified: `xcodebuild -scheme "React Watch Widgets"` = BUILD SUCCEEDED.
- [ ] CX-015 (Map camera — SwiftUI), CX-017 (relevantContexts — WidgetKit API): host/Xcode. SD-1/SD-6 bridge+codegen (CX-022/023/024)
- [~] Phase 4 DX (CX-011/012/020 + DX-1..7), Phase 5 — partial:
  - [x] **CX-011** (`widget:false` convergence) — see its verdict row.
  - [x] **DX-6** (typed connectivity contract) — `defineMessages<T>()` wraps `sendToPhone`/`onPhoneMessage` into typed `send`/`on` over one shared `T` (`{ type, payload }` envelope, `on` dispatches by type). +2 tests (JS 232). The both-sides *example* (iPhone companion using the same contract) still needs the companion app + a device.
  - [ ] remaining: **CX-012/DX-2** (own linking+plist in-plugin — large, re-architects the prebuild lifecycle), **CX-020/DX-1** (example dogfoods the plugin + READMEs), **DX-3** (scaffolder), **DX-4/DX-7** (packaging tarball + smoke), Phase 5 — a deliberate DX workstream, not blind overnight pieces.
- [x] Host fixes (written + **verified on a watchOS build** — Xcode is available here): **CX-009** (reject a wire-mismatched commit before it reaches the interpreter or advances the ack), **OP-3** (cap app QuickJS heap at 64 MB), **OP-6** (stable Map annotation id).
- [x] CX-015 — Map `latitude`/`longitude`/`span` props now drive `Map(initialPosition: .region(...))` (were ignored); `.automatic` fits annotations when absent. Verified on watchOS build.
- [~] **ARCH-04** (transactional OTA state machine):
  - [x] slice 1 / **OP-1** — bytecode cache keyed to a source `ContentHash` in `OTAMeta`; `evaluateOTA` trusts the `.qbc` only on a hash match, so a crash mid-apply or a stale cache can't run old code as if it were this bundle. +1 test (swift 70), watchOS BUILD SUCCEEDED.
  - [x] slice 2 — **read-only validation**: `persistOTA` evals the candidate in a throwaway runtime (host callbacks nil → no-op commit/setItem/publish) and refuses to persist a bundle that throws on load, so a bad bundle is never saved and can't partially mutate storage during the check. +1 test (swift 71), watchOS BUILD SUCCEEDED.
  - [x] slice 3 — **crash-loop boot rollback**: `SharedWidgetStore.otaBootAttempts` counts boots that ran the OTA bundle but never reached a healthy commit; `load()` increments before eval and rolls the bundle back (drop + shipped) once it hits `maxOTABootAttempts` (3); `onCommit` resets the counter on the first committed tree. Catches the *native*-crash case the JS-throw fallback can't (process dies before the catch). +3 store tests (swift 74), watchOS BUILD SUCCEEDED. Counter/decision are unit-verified; the rollback *trigger* (an actual native boot crash) is compile-verified only — needs an on-device crash scenario to exercise end-to-end.
  - [x] slice 4 — **atomic apply**: source + version/signature/bytecodeHash collapse into one `OTARecord` (Support, shared/testable) written with a single atomic `JSONEncoder` write — the commit point. Replaces the old two-file (`.js` + `.json`) write whose crash window could pair a new source with a stale version/signature. Bytecode `.qbc` is now pinned by `ContentHash.of(blob)` (the blob's own hash, not the source) so a stale/partial `.qbc` is never trusted. +5 tests (OTARecord round-trip, `ContentHash.of(Data)`; swift 77), watchOS BUILD SUCCEEDED.
  - [x] **CX-007 — signing `keyId`/rotation**. The signed message is now `"v1:<keyId>:<version>:<js>"` — the `keyId` is bound *inside* the signed bytes, so it can't be swapped to steer the host to a different key (the JWT `kid`-confusion failure mode). `OTAConfig.publicKeyBase64` → **`signerPublicKeys: [keyId: base64]`** (a trusted-key map shipping inside the code-signed binary); verification looks the `keyId` up and **fails closed** on an unknown id. Rotation = trust `{old,new}` then drop `old` in a later release (rotate-then-revoke overlap window, documented in `ota-signing.md`). `keyId` charset is colon-free (`UpdatePlan.isValidKeyId`, enforced on the **verifier**) so the `:`-delimited message stays injective. Threaded through `ota-keygen` (emits a kid + paste-ready map literal), `ota-sign` (`OTA_SIGNING_KEY_ID`, writes `keyId` to the manifest), `UpdateManifest`/`applyUpdate`/`fetchAndApplyUpdate`, `RemoteManifest` native recovery, and `OTARecord` (audit field). Tests: regenerated Node↔CryptoKit interop vector (now kid-bound, + a swapped-kid-fails assertion), `isValidKeyId`, `signedMessage` colon/nil cases, OTARecord round-trip, JS payload threading. Verified: JS 212, `swift test` 80, **watchOS BUILD SUCCEEDED**, keygen+sign round-trip smoke. Design sanity-checked against expo-updates/JWT/TUF (bind-kid + fail-closed + overlap-window confirmed). Previous-known-good rollback still intentionally deferred (crash-loop falls back to the always-valid *shipped* bundle).
- [x] **CX-021** (`fetch` — honest WHATWG *subset*). Done as one change after owner direction (don't over-restrict, don't fake API the host can't honor):
  - **No JS scheme gatekeeping.** The native `FetchPlan` + URLSession are the single URL authority — they accept any *absolute* URL and reject the rest. So any scheme (incl. a custom app scheme like `xapp://`) passes through verbatim and works iff URLSession supports it; JS no longer pre-restricts to http(s). (An earlier http(s)-allowlist slice was reversed here — it duplicated native validation and blocked schemes native would attempt.)
  - **Single-use body** (`bodyUsed`; first `text()`/`json()`/`arrayBuffer()` consumes, second rejects with `TypeError`).
  - **Honest header**: documents the supported subset and what's *intentionally not* implemented (`Request` input, `clone`, `credentials`/`cache`/`redirect`, `Blob`/`FormData`) — the host can't honor them, so adding them would be the false "WHATWG-aligned" claim the review flagged.
  - TDD: JS passthrough test written red → green; Swift `FetchPlanTests` gained "any absolute scheme accepted" + "schemeless rejected" to lock the native contract. JS suite 201, `swift test` 79, typecheck + biome clean.
- [x] **ARCH-03** — **separate app & widget bundles** (build-only; CX-004 deepened). `demo/entry.tsx` split into `app.entry.tsx` (mounts UI + seeds/syncs complications) and `widget.entry.tsx` (registers intent + timeline handlers only — no `App` import, no `runApp`). Build emits two bundles: the app keeps the name `dist/bundle.js` (dev server, OTA manifest, dev-fetch URL unchanged) and the new `dist/widget.bundle.js`; each copies to `bundle.js` in its target dir, so **no Swift change** (native loads the resource named "bundle" from its own target). The widget process no longer evaluates app code — minified widget 143 KB vs app 171 KB. Per-target size budgets (app 200 / widget 160) + bytecode tooling now cover both. The `qjs-smoke` intent run loads the **widget** bundle with a `commit`-throws guard, proving it never mounts UI. JS suite 201, widget Xcode scheme BUILD SUCCEEDED. (OTA-side dual-bundle release = SD-4, separate.)
- [x] **CX-008 / SD-5** — **generation token on reload**. `boot()` reset the id space (`nextSeq`, JS fetch/generate ids) and dropped the runtime but never cancelled in-flight async, so a late fetch/generate callback could settle the WRONG pending request in the fresh runtime (id reuse). Added a `generation` counter bumped each boot; the two id-carrying async paths (fetch completion, FoundationModels generate) capture it and drop their result if it no longer matches. `boot()` also cancels outstanding `fetchTasks` and calls a new `SensorBridge.stopAll()` so stale streams don't push into the new runtime. BLE is intentionally left connected (stateful link, not worth dropping on a dev hot-reload; its events are name-routed, not id-keyed). watchOS BUILD SUCCEEDED. (OP-2 main-thread assert + full RuntimeSession isolation = ARCH-08, later.)
- [x] **CX-005** — **applyUpdate reports the watch's verdict**. It was fire-and-forget (`void`), so a rejected OTA (bad signature, capability gap, downgrade, write failure) vanished. `applyUpdate` now returns `Promise<SaveUpdateResult>` that *resolves* `{accepted}` (never throws); a refusal comes back `{accepted:false, code, message}` with the native reason. Wired with the existing per-op `__resolve*/__reject*` convention (consistent with fetch/generate): `saveUpdate(id, json)` on the bridge, `resolveSaveUpdate`/`rejectSaveUpdate` settling on the main thread; `fetchAndApplyUpdate` returns `null` when the watch refuses a downloaded bundle. +2 OTA tests incl. the rejection path (JS suite 202), `swift test` 79, watchOS BUILD SUCCEEDED. **SD-1's *generic* `invoke` channel deferred** — moving `saveUpdate` out of `hostMethods` would drop the `ota` feature from the ARCH-01 taxonomy, a design fork worth its own pass; per-op pairs match the codebase today.
- [~] **CX-022** — typed results for silent fallible native ops:
  - [x] **notification permission** — was fire-and-forget (`requestAuthorization { _, _ in }`, result dropped). `requestNotificationPermission()` now returns `Promise<NotificationPermission>` (`granted | denied | notDetermined | provisional | unavailable`), settled via `resolveNotificationPermission`/`rejectNotificationPermission` (per-op pair, like CX-005). The host resolves from `getNotificationSettings().authorizationStatus`, **not** the raw granted `Bool` — `.provisional` silently returns `granted == true`, so a Bool would mislabel a quiet-only grant (research-driven). Completion marshalled to main + generation-guarded (CX-008); native error → reject. +3 JS tests (suite 204), `swift test` 79, ReactWatchHost BUILD SUCCEEDED.
  - [x] **SD-1 generic `invoke` channel** — replaced the per-op pairs with one `__host.invoke(id, method, payloadJson)` settled by `__resolveInvoke`/`__rejectInvoke` (`js/src/invoke.ts`): one correlation-keyed pending map, a single `settle()` that deletes-then-settles (settle-exactly-once), a closed-enum error `code` (`UNKNOWN_METHOD`/`PERMISSION_DENIED`/`UNAVAILABLE`/`INVALID_REQUEST`/`INTERNAL`), and an unknown method **rejects** (never hangs). **saveUpdate + requestNotificationPermission migrated onto it** (their dedicated host methods + `__resolve*/__reject*` bridges removed). Taxonomy preserved without two lists: schema keeps one `hostMethods` with a `via:"invoke"` flag → features still derive from it (ARCH-01 unchanged), and the cross-check test now verifies *direct* installs **and** that the host routes every `via:"invoke"` method. fetch/generate stay dedicated (abort/streaming), sensor/BLE keep the push channel, no cancellation in v1 — all per research (Capacitor/RN/TurboModule prior art). +invoke.test (suite 209), `swift test` 79, ReactWatchHost BUILD SUCCEEDED, swift lint clean.
  - [x] **connectivity send** — `sendToPhone(message)` was fire-and-forget (`sendMessage(replyHandler:nil, errorHandler:nil)`, falling back to a silent `updateApplicationContext` when unreachable). Now returns `Promise<reply>` over invoke: `PhoneConnectivity.send` uses `sendMessage` with reply/error handlers, resolves the phone's reply, and rejects (with an InvokeError `code`) when not reachable or on a `WCError` (mapped to the closed enum; detail in `message`). Handlers fire on a background queue → marshalled to main + generation-guarded (research-driven). +connectivity tests updated (suite 209), `swift test` 79, ReactWatchHost BUILD SUCCEEDED, swift lint clean.
  - [x] **scheduleNotification** migrated onto invoke (commit `7c76117`): returns `Promise<ScheduleNotificationResult>` so an `add` failure reaches JS instead of clobbering `runtimeError`. The owner's sync-id concern is kept — the deterministic id is always in the result, the demo (explicit id, ignores return) is unaffected. JS 217, swift test 80, watchOS BUILD SUCCEEDED.
  - [ ] remaining op — **BLE connect/write** (device-gated). Design is now written ([design-ble-result-reporting.md](./design-ble-result-reporting.md)): route connect/write/subscribe through invoke, put the id↔result correlation in the pure (Linux-tested) `BleSession`, keep CoreBluetooth I/O in the bridge. **Deliberately not shipped blind** — the behaviour it correlates (connect/drop/reconnect, write acks) only exists against a real BLE peripheral (no simulator radio), so a blind state-machine change to working BLE could regress the demo uncatchably. Implement + verify when a watch + the movie-remote peripheral are available.
- [x] **CX-024 / SD-6** — **component contract + interpreter drift guard**. `schema.mjs` now declares `components` (the 25 primitive types + each one's widget support: `full | degraded`) as the single source of truth, generated to a `COMPONENTS` TS const. `component-contract.test` asserts BOTH SwiftUI interpreters (`NodeView` app + `WidgetNodeView` widget) handle *exactly* the contract — catching the CX-018 drift class (a primitive handled in one and silently dropped in the other) at test time. (Research flagged a typed `Record` for compile-time exhaustiveness, but our interpreters are Swift switches that must keep a `default:` for forward-compat, so the parse-the-cases test is the right tool here.) JS suite 212, drift + typecheck + biome clean.
- [x] **UI**: unsupported node types now log (done, `9d1d330`).
- [x] **CX-027 — docs: split verified status from plan**. New [status.md](./status.md) is the single evidence-backed "is it real yet?" view — a maturity-tiered capability matrix (① logic-tested / ② builds-for-watchOS / ③ device-verified / ⛔ blocked, each level naming its mechanical check), every row linked to a test/build. Corrects the two flagged overclaims: **on-device AI** = ⛔ blocked (gated `watchOS 26.0` but Foundation Models is `27.0+`, fix unshipped + Xcode-27-gated — CX-002), and **`relevantContexts`** = partial (ranking ② wired, predictive surfacing decoded-not-applied — CX-017). `roadmap.md` keeps its history but now defers to status.md (top banner) with both overclaims fixed inline; indexed in `docs/README.md`. Design checked against Rust target-tiers / repostatus / Keep-a-Changelog (tense-ownership: roadmap=future, status=falsifiable-now, "blocked" stays in the matrix, "planned" stays out). README/publishing carried neither overclaim.
- [x] **CX-017** — both halves now wired. (1) per-entry `TimelineEntryRelevance(score:duration:)` = the Smart Stack **ranking** signal (was already done). (2) **predictive `relevantContexts` → surfacing DONE**: `ReactTimelineProvider.relevance()` (watchOS 11+) maps each published hint to a RelevanceKit `RelevantContext` — `.location(CLCircularRegion)` when coords are present, else `.date` — wrapped in `WidgetRelevance([WidgetRelevanceAttribute<Void>(context:)])`. Both the static `ReactTimelineProvider` (`WidgetRelevance<Void>`) and the configurable `ShoppingTimelineProvider` (per-list `WidgetRelevance<SelectShoppingListIntent>`) implement it, via a shared `reactRelevantContext`/`reactRelevantContexts` helper. **Widget Xcode build (`React Watch Widgets`) SUCCEEDED** against the watchOS-26 SDK, so the API/shape is verified; only the actual Smart-Stack *surfacing behavior* is device-only.

### Verdict legend

| Badge | Meaning |
|---|---|
| ✅ **REAL** | Reproduced in current code; genuine problem. |
| 🩹 **REAL (minor)** | Genuine but low-impact / cosmetic / DEBUG-only. |
| ⛔ **SKIP** | Real observation, but won't action — conflicts with a standing decision. |
| ✔️ **DONE** | Already resolved; not a problem anymore. |

Effort: **XS** <½h · **S** ~1–2h · **M** ~half-day · **L** ~1+ day.

---

## Architecture decisions — do these FIRST (they subsume backlog items)

Design-level calls from the [system-design review](./system-design-review-2026-06-25-1824-opus.md), refined with the owner 2026-06-25. Several backlog rows are *symptoms* of these — doing these deletes those rows. **Sequence:** publish-blockers (CX-001/003/002, orthogonal/fast) → **SD-3+SD-4** → **SD-2** → **SD-1+SD-6** → SD-5 rides with Phase 1 → then the remaining per-item phases. SD-3/SD-4 each get a short design note before code (data/App-Store-update posture).

| SD | Decision | Subsumes | Status |
|----|----------|----------|--------|
| **SD-3** | Native-capability compatibility gate (upper = min-native, lower = anti-rollback) | CX-004, CX-007 | [design ready](./design-ota-capability-gate-2026-06-25-1847.md) |
| **SD-4** | OTA = one state machine + single active-bundle record shared by app+widget | CX-004/005/006/007/025 | [design ready](./design-ota-capability-gate-2026-06-25-1847.md) |
| **SD-2** | One shared SwiftUI interpreter for app + widget | CX-018, CX-024 (CX-015/017 ride along) | [design ready](./design-shared-interpreter-2026-06-25-1855.md) |
| **SD-1** | Typed command/result channel for fallible native ops | CX-005, CX-022 | [design ready](./design-typed-bridge-codegen-2026-06-25-1855.md) |
| **SD-6** | Schema = single source for wire + bridge + component contract | CX-023, CX-024 | [design ready](./design-typed-bridge-codegen-2026-06-25-1855.md) |
| **SD-5** | Enforce (+ later isolate) the JS thread | CX-008, OP-2 | → RuntimeSession (ARCH-08) |

### Codex second-pass review — adopted refinements (2026-06-25)

A [second architecture review (Codex)](./system-architecture-review-2026-06-25-1859-codex.md)
(ARCH-01…14) pressure-tested the SD decisions. I verified its load-bearing
claims against the code — **two corrected my own notes** — and adopt the
following. Net: the model gets *more correct*, and pre-release the breaking
changes are free.

**Supersedes / corrects the SD notes:**
- **SD-3 scalar → feature manifest (ARCH-01).** One `hostApiVersion`/`minHostApi`
  integer can't model what's really a *set*: app vs widget differ; features need
  entitlements/OS/permission; a consumer may disallow some. Replace with
  **structural versions** (`wireVersion`, `bridgeProtocol`, `engineABI`) + a
  **per-target feature set** the binary provides; the bundle declares
  **`requiredFeatures`/`optionalFeatures`**; gate = `requiredFeatures ⊆
  provided` (+ policy). `fetchX` becomes "is `network.fetchX` provided?" — set
  membership, not `N ≥ M`.
- **SD-3 metafile → explicit declared contract (ARCH-02).** *Correction:*
  `esbuild/preset.mjs` does **not** emit a metafile (my note was wrong), and
  import-presence isn't a sound authority anyway. The bundle **declares** its
  features; generated wrappers/primitives emit stable markers; **static analysis
  is a build CHECK that fails loud on an undeclared capability** (so it still
  can't be silently forgotten) — not the signed authority.
- **"No DB" was too strong (ARCH-05).** *Correction:* structured shared state
  **already exists** — [shoppingStore.ts](../js/demo/shoppingStore.ts) keeps
  `ShoppingList[]` in the App Group, written by **both** app and widget-intent
  via whole-object `Storage.set` → lost-update is a **present** gap. Minimal now:
  add **`dataSchemaRange`** to the release contract + route structured mutations
  through one path with a `revision` + atomic write; defer a full SQLite/migration
  engine.
- **SD-5 → RuntimeSession (ARCH-08).** A session object owning
  executor/root/registries/cancellation + `dispose()` beats a bare
  generation-token; absorbs CX-008 + the module-global smell + testability.
- **SD-1 → generated typed envelopes (ARCH-11).** `{requestId, methodId, payload,
  deadline, sessionId} → result|error|cancelled` with timeout/cancellation, not a
  generic stringly `invoke`.
- **SD-2 → shared core + adapters (ARCH-10).** A `RenderAdapter` protocol per
  target, not one `interactive: Bool`.

**New items adopted:**
- **ARCH-03 — separate app & widget bundles (P0).** Today one `bundle.js` is
  copied to both; the widget evals the *whole app artifact* in a 16 MB cap. Split
  into `app.bundle.js` + `widget.bundle.js`, one signed release, independent
  hashes/sizes/features/budgets. (Deepens CX-004 — the widget shouldn't run app
  code at all.)
- **ARCH-04 expansions — OTA validation + rollback (P0).** Validate a candidate
  with a **read-only host** (eval can otherwise mutate/publish), explicit
  `bundleReady`, **crash-loop rollback** to previous known-good, signing `keyId`
  + rotation.
- **ARCH-07 — HostPolicy (P1).** Install only consumer/target-allowed features;
  authorization separate from compatibility (cheap once features are a set).
- **ARCH-09 — JS-confirmed lazy navigation (P1).** Sync event bridge as a nav
  transaction so only the active stack serializes (kills eager-mount); structured
  event result `{handled, accepted, reason}` (pairs with CX-010).
- **ARCH-12 — split WatchConnectivity by delivery semantics (P2)** — refines DX-6.
- **ARCH-13 — structured diagnostics + operating budgets (P1).** Replace the
  single last-write-wins `runtimeError`; enforce node/JSON/commit budgets.
- **ARCH-14 — isolate the reconciler surface (P2).** The `as never` cast vs
  mismatched `@types` is upgrade-fragile; one adapter + pinned versions + matrix.

**Kept simple / not wholesale:** full SQLite `StateStore` + migration framework
(revision+atomic-doc now, engine later); the 6-module npm split (one npm facade —
Codex agrees; split Swift modules incrementally); the full metrics suite (start
small); freezing all feature work in Phase 0.

**Revised first move (Codex's, and I agree):** **ARCH-01 + ARCH-03 + ARCH-04
together** — feature model + per-target artifacts + transactional release are the
foundation state/codegen/widget-safety/rollback all build on. The scalar
`hostApiVersion` would be thrown away if built first.

### SD-3 — capability compatibility gate (the `fetchX` problem) ← top priority

The risk is **not** old-code/new-data (there's no DB). It's a **new OTA bundle calling a native capability the installed binary lacks** — new JS calls `fetchX`, the old Swift client has no `fetchX` → crash. Two-sided gate:

- Native binary exposes **`hostApiVersion: Int`** — bump when a `__host.*` capability is added.
- Each JS bundle declares **`minHostApi: Int`** — the newest native capability it uses.
- A separate monotonic **`releaseId`** — freshness + anti-rollback ordering.
- Gates, checked in **JS (pre-download)**, **native (at save)**, and **native (at boot)**:
  - **Upper:** `bundle.minHostApi ≤ native.hostApiVersion` — else **block + "Update the app"** (App Store; OTA can't fix a too-old binary). Covers new-JS-on-old-client *and* a native downgrade below a staged bundle (the "app reinstalled older / filesystem" case).
  - **Lower:** `bundle.releaseId ≥ highWater` — downgrade blocked.
  - signature valid (CX-003 fail-closed).
- Expose `native.hostApiVersion` to JS so `checkForUpdate` gates before downloading.
- Defense-in-depth (optional): host-call wrappers throw a typed `"capability X needs app vN"` instead of `undefined is not a function`.

Makes CX-007's "split" concrete: **`releaseId`** (freshness+rollback) + **`hostApiVersion`/`minHostApi`** (capability). **Open:** `minHostApi` manual vs build-derived; runtime guard yes/no; (no DB → no data-migration concept for now).

### SD-4 — OTA state machine

One explicit active-bundle record `{releaseId, minHostApi, hash, signature}`, identical for app + widget; atomic apply (CX-006/OP-1); request/response apply (CX-005, via SD-1); the widget participates in the same gate (CX-004) instead of blindly loading `Bundle.main`.

### SD-2 — one shared interpreter (how)

- New watchOS-only module **`ReactWatchUI`** in the SPM package (above Core/Support, below Host).
- Pure parsing → `ReactWatchSupport` (Linux-tested): hex→RGBA, font-name→enum, value format, timer math (return *data*, not SwiftUI types).
- One `NodeView` parameterized by a **`RenderContext`**: `interactive` (app) vs read-only (widget) + an **injected dispatcher** (app → `ReactWatchModel`; widget → no-op). That injected seam lets one view serve both processes.
- App host + widget extension both import it; **delete `WidgetNodeView`**.
- Golden contract test: every primitive × {app, widget}. (CX-016 stays separate — it's timeline *selection* in the provider, not interpretation.)

### SD-1 — typed command/result channel (what we do)

Today fallible ops are fire-and-forget → failures vanish. Make them look like `fetch`: a generic `__host.invoke(id, method, payloadJson)` → `__resolveInvoke(id,json)` / `__rejectInvoke(id, {code,message})`, wrapped as Promises. Route `saveUpdate` (→CX-005), notification permission (granted/denied), `scheduleNotification`, BLE connect/write through it. Keep sync `getItem`; keep the push channel for streams.

### SD-6 — finish codegen

Make `schema.mjs` the authority for: wire structs (done), the **bridge** (generate install table + C trampolines + TS types from `hostMethods`, tagged `since` for SD-3), and the **component contract** (primitives/props/events/app+widget support → feeds SD-2's test).

### SD-5 — thread

Assert main-thread on the JS settle calls (OP-2) + generation token on reload (CX-008) now; consider a dedicated JS queue later (don't speculate).

---

## Phase 0 — Publish blockers & safety (fast, decision-clear) — do first

| # | ID | Problem | Verdict | Evidence | Fix | Eff |
|---|----|---------|---------|----------|-----|-----|
| 1 | CX-001 | npm tarball ships `swift/.build` (~300 MB); no license | ✅ REAL | [package.json:57](../js/package.json) `files:["swift"]`; no `license` field | Explicit `files` allowlist (`swift/Package.swift`, `swift/Sources/**`, `swift/README.md`); add `LICENSE` + `license` field | S |
| 2 | CX-003 | Malformed OTA key → silent **fail-open** (defeats your db gate) | ✅ **DONE** | was: decode chain → `nil` → unsigned branch | New pure `OTAKeyState.classify` (Support, Linux-tested) gives 3 states: **disabled** (no keys → fail-open), **enforced** (≥1 key decoded → verify; a bad key is dropped + warned), **misconfigured** (keys set but NONE decoded → `saveUpdate` refuses all OTA *loudly*, `load` keeps anti-rollback — never the silent fail-open). +4 classifier tests (`swift test` 84), watchOS BUILD SUCCEEDED. | S |
| 3 | CX-002 | `generateText` gated at `watchOS 26.0` — wrong | 🔧 **gate+maxTokens fixed** | [ReactWatchHost.swift:292](../js/swift/Sources/ReactWatchHost/ReactWatchHost.swift); FM is **watchOS 27.0+ (beta)** via `SystemLanguageModel` (Apple docs, re-verified) | **DONE:** gate → `watchOS 27.0` (kept `canImport`); `maxTokens` → `GenerationOptions.maximumResponseTokens` (JS already threaded it; +ai test); doc'd the watchOS-27-SDK build need (status.md). watchOS BUILD SUCCEEDED (FM block compiles out on the 26.2 SDK, as expected). **+ runtime capability query DONE:** `isOnDeviceAIAvailable()` (JS) → invoke `aiAvailability` → `SystemLanguageModel.default.isAvailable` (watchOS 27+, else `false`). The `false` fallthrough compiles + is tested here; the FM branch is doc-backed (SDK-pending). **Remaining (SDK-gated):** only device-verify of the FoundationModels path (gen + availability) on Xcode 27 / a watchOS 27 device. | S |

## Phase 1 — Runtime safety (contained correctness)

| # | ID | Problem | Verdict | Evidence | Fix | Eff |
|---|----|---------|---------|----------|-----|-----|
| 4 | CX-010 | Handlerless / throwing events strand optimistic controls | ✅ REAL | [renderer.ts:275](../js/src/renderer.ts) bumps `lastSeq` then `return false` pre-ack; [events.ts:24](../js/src/events.ts) handler not try-caught | Ack (or neg-ack) in a `finally`; render handlerless controls read-only using the existing `onChange:true` wire flag ([serialize.ts:17](../js/src/serialize.ts)) | M |
| 5 | CX-009 | Wire-version mismatch warns then renders anyway | ✅ REAL | [ReactWatchHost.swift:421](../js/swift/Sources/ReactWatchHost/ReactWatchHost.swift) sets error, then `self.root = tree.root` + advances ack | Reject the commit before mutating root/ack; OTA → quarantine + boot shipped; shipped mismatch → blocking startup error | S |
| 6 | CX-008 | Reload (`boot`) doesn't cancel in-flight async → id reuse | ✅ REAL | [ReactWatchHost.swift:107](../js/swift/Sources/ReactWatchHost/ReactWatchHost.swift) resets `nextSeq`, drops runtime; never cancels `fetchTasks`/sensors/BLE | Generation token captured by async callbacks; cancel fetches/sensors/BLE on boot | M |
| 7 | CX-014 | Sensor `start`/`stop` per-call, no refcount | ✅ REAL | [sensors.ts:34](../js/src/sensors.ts) one unmount stops a shared stream | Per-kind refcount in JS; start 0→1, stop 1→0 | S |
| 8 | CX-019 | Inspector poll fetch unguarded → rejection-banner spam offline | 🩹 REAL (DEBUG) | [inspector.ts:61](../js/src/inspector.ts) no `.catch`; my CR-1 tracker now surfaces each | `.catch(()=>{})` + rate-limit + stop handle/clear interval | S |
| 9 | OP-2 | No main-thread assertion on JS settle calls (latent heap corruption) | ✅ REAL | [JSRuntime.swift:169](../js/swift/Sources/ReactWatchRuntime/JSRuntime.swift) doc says main-only, nothing enforces | `dispatchPrecondition(.onQueue(.main))` (DEBUG) + audit every `runtime?.` call site | S |
| 10 | OP-3 | App QuickJS heap uncapped (widget caps at 16 MB) | 🩹 REAL | [ReactWatchHost.swift:406](../js/swift/Sources/ReactWatchHost/ReactWatchHost.swift) `JSRuntime()` no limit | Pass a generous cap (48–64 MB) so it throws before OS jetsam | XS |
| 11 | OP-4 | `Int32(truncatingIfNeeded:)` on seq/ids | 🩹 REAL | [JSRuntime.swift:264](../js/swift/Sources/ReactWatchRuntime/JSRuntime.swift) | `JS_NewInt64` for `seq` or assert bound | XS |
| 12 | OP-6 | Map annotation identity = array offset (churns on reorder) | 🩹 REAL | [NodeView.swift:320](../js/swift/Sources/ReactWatchHost/NodeView.swift) `id: \.offset` | Stable id from lat/lon/title | XS |
| 13 | OP-5 | `describe()` appends `\nundefined` for non-Error rejections | 🩹 REAL | [JSRuntime.swift:464](../js/swift/Sources/ReactWatchRuntime/JSRuntime.swift) | Guard on `JS_IsError` / skip `"undefined"` stack | XS |

## Phase 2 — OTA coherence (your top concern: "old JS must not touch the new-schema db")

| # | ID | Problem | Verdict | Evidence | Fix (decided) | Eff |
|---|----|---------|---------|----------|---------------|-----|
| 14 | CX-004 | **Widget runs the binary's old JS & writes the shared store after OTA** | ✅ REAL | [IntentRuntime.swift:50](../app/targets/widget/IntentRuntime.swift) loads only `Bundle.main`; handlers `onSetItem`/publish | **Shared verified loader** used by app + widget; widget honors high-water + hard gate, never mutates when blocked | L |
| 15 | OP-1 / CX-006 | Mid-apply crash pairs **old** bytecode with **new** source → silently runs stale code; writes not transactional | ✅ REAL | [ReactWatchHost.swift:201](../js/swift/Sources/ReactWatchHost/ReactWatchHost.swift) independent `try?` writes; [:376](../js/swift/Sources/ReactWatchHost/ReactWatchHost.swift) prefers bytecode | Atomic staged apply; key bytecode to source hash (store in meta), refuse on mismatch | M |
| 16 | CX-005 | `applyUpdate` reports success before native accepts | ✅ REAL | [update.ts:29](../js/src/update.ts),:85 return `void`/version pre-accept | Make `saveUpdate` request/response (like fetch); return `{accepted, active, restartRequired, reason}` | M |
| 17 | CX-007 / CX-025 | Version is both rollback gate AND freshness → non-breaking fixes never ship; two manual sources | ✅ REAL | [update.ts:81](../js/src/update.ts) `version >`; [config.mjs:15](../js/scripts/config.mjs) + [ReactWatchHost.swift:649](../js/swift/Sources/ReactWatchHost/ReactWatchHost.swift) | **Split:** keep integer as gate; add release id (content hash/build #) for freshness; JS reads native active state; one source for the gate version | M |

## Phase 3 — Kill the interpreter-drift class

| # | ID | Problem | Verdict | Evidence | Fix | Eff |
|---|----|---------|---------|----------|-----|-----|
| 18 | CX-018 / CX-024 | App vs widget interpreters diverge (hex color, monospacedDigit, timer ms); contract hand-synced | ✅ REAL | [WidgetNodeView.swift:200](../app/targets/widget/WidgetNodeView.swift) no hex vs [NodeView.swift:432](../js/swift/Sources/ReactWatchHost/NodeView.swift); :125 drops monospacedDigit; :153 ignores ms | Extract shared pure style helpers (hex/font/format/timer) into a watchOS-only shared module both call; one test enumerating every primitive's app/widget support | M |
| 19 | CX-016 | Widget snapshot picks a **future** entry (`.last`) | ✅ REAL | [ReactWidgets.swift:72](../app/targets/widget/ReactWidgets.swift) `entries.last` | Pick latest entry with `date ≤ now`, else earliest | S |
| 20 | CX-015 | `Map` region props (`latitude/longitude/span`) public but ignored | ✅ REAL | [components.ts:235](../js/src/components.ts) vs [NodeView.swift:316](../js/swift/Sources/ReactWatchHost/NodeView.swift) reads only annotations/route/height | Implement camera/position binding, or drop the props | S |
| 21 | CX-017 | `relevantContexts` serialized but not applied | 🩹 REAL | [ReactWidgets.swift:55](../app/targets/widget/ReactWidgets.swift) decoded, "remaining native step" | Map to WidgetKit relevance, or mark experimental + drop "shipped" claim | S |

## Phase 4 — Consumer path / DX

> Full DX analysis (what the config plugin already does vs the 2 post-prebuild
> gaps, connectivity, npm-consumption) is in the
> [DX & integration review](./dx-integration-review-2026-06-25-1859.md)
> (DX-1…DX-7). The table below is the CX subset of that work.

| # | ID | Problem | Verdict | Evidence | Fix | Eff |
|---|----|---------|---------|----------|-----|-----|
| 22 | CX-011 | Plugin doesn't remove stale `expo-target.config.js` on `widget:false` | ✅ **DONE** | was: only added under `if(opts.widget)`, no removal | `widget:false` now converges: `removeGeneratedTargetConfigFile` drops the **marker-gated** (`// AUTO-GENERATED`) widget config so apple-targets stops discovering it (never deletes a hand-authored file or the Swift glue), and `withEasAppExtensions` reconciles by removing a previously-added widget EAS entry. +4 tests (EAS reconcile + temp-dir removal: marker / no-marker / absent). JS 230, biome clean. | M |
| 23 | CX-012 | Not a true one-line integration (needs `postprebuild` for link/Info.plist) | ✅ REAL | [plugin/index.js](../js/plugin/index.js) defers linking + plist merge | Own linking + plist in one ordered plugin (or a documented prebuild executable); add `entry` option | L |
| 24 | CX-020 | Expo example doesn't dogfood the package's plugin | ✅ REAL | [examples/expo-watch-app/app.json:14](../examples/expo-watch-app/app.json) lists only `@bacons/apple-targets`; README refs old paths; minimal-app README says `file:` vs `workspace:*` | Make the example a clean-room consumer of the config plugin; fix READMEs | M |

## Phase 5 — Maintainability & API surface

| # | ID | Problem | Verdict | Evidence | Fix (decided where noted) | Eff |
|---|----|---------|---------|----------|-----|-----|
| 25 | CX-021 | Global `fetch` not WHATWG (re-readable body, URL-string only, no clone/credentials/redirect; non-http accepted) — yet header claims "WHATWG-aligned" | ✅ REAL | [fetch.ts:205](../js/src/fetch.ts) re-readable; :235 string-only; no `clone`; FetchPlan no scheme allowlist | **Tighten toward WHATWG:** Request input, body-used state, `clone`, credentials/cache/redirect, allowlist `http(s)` | L |
| 26 | CX-022 | Native ops fail silently (BLE/sensor/perm/connectivity/storage) | ✅ REAL | e.g. notif permission dropped `{ _, _ in }` [ReactWatchHost.swift:471](../js/swift/Sources/ReactWatchHost/ReactWatchHost.swift); BLE/connectivity fire-and-forget | Typed native result/error channel; commands that can fail return promises / correlated events | L |
| 27 | CX-023 | Host bridge hand-duplicated though a `hostMethods` manifest exists | ✅ REAL | manifest [schema.mjs:148](../js/codegen/schema.mjs) only *test-checked* ([codegen.test.ts:5](../js/test/codegen.test.ts)); install hand-written [JSRuntime.swift:359](../js/swift/Sources/ReactWatchRuntime/JSRuntime.swift) | Generate `QuickJSHostGlobal` + Swift props + C callbacks + install table from the schema | L |
| 28 | CX-026 | `ShoppingIntent.swift` duplicated across watch & widget targets | ✅ REAL | `diff` of the two files → **identical** | Move shared intent models into one app-specific product, or generate both | S |
| 29 | CX-027 | Docs mix current/plan/"shipped" (e.g. on-watch AI, relevantContexts) | ✅ REAL | claims scattered across `roadmap.md`/`publishing.md`/`README.md` + 3 review docs; FM "shipped" vs CX-002; CX-017 | Split `status.md` (verified) vs `roadmap.md` (future); link "shipped" claims to test/build evidence | M |

## Not actioning

| ID | Problem | Verdict | Why |
|---|---------|---------|-----|
| CX-013 | macOS/Swift native build is `workflow_dispatch`-only, not a PR gate | ⛔ SKIP | Real ([react-native-watchos-build.yml:13](../../../.github/workflows/react-native-watchos-build.yml)), but you don't rely on Actions for native; stays manual. (Linux `ci.yml` already gates JS.) |
| CX-028 | OTA signing scripts needed integration | ✔️ DONE | CR-17 work: tracked, Biome-clean, `ota:keygen`/`ota:sign` in [package.json:66](../js/package.json), `OTASigningTests.swift`, secret handling in [ota-signing.md](./ota-signing.md). Repo tooling (not in npm `files`). |

---

## Summary counts

- ✅ REAL (act): **23** — CX-001,002,003,004,005,006,007,008,009,010,011,012,014,015,016,018,020,021,022,023,026,027 + OP-2.
- 🩹 REAL minor: **6** — CX-017,019 + OP-1\*,OP-3,OP-4,OP-5,OP-6. (\*OP-1 is minor-likelihood but high-severity-if-hit → ranked in Phase 2.)
- ⛔ SKIP: **1** — CX-013 (your decision).
- ✔️ DONE: **1** — CX-028.

Nothing in the two reviews turned out to be a non-issue except **CX-028 (done)**;
**CX-013** is a true observation we're intentionally not acting on. Everything
else reproduced in current code.

Suggested first move: **Phase 0 (#1–#3)** — all three are decision-clear and
fast, and two of them (CX-003, CX-002) are about the exact things you care about
(db safety, honest feature claims).
