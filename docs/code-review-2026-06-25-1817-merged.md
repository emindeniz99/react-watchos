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
| 2 | CX-003 | Malformed OTA key → silent **fail-open** (defeats your db gate) | ✅ REAL | [ReactWatchHost.swift:73](../js/swift/Sources/ReactWatchHost/ReactWatchHost.swift) decode chain → `nil` → unsigned branch :192 | 3 states absent/valid/**invalid**; invalid = refuse OTA loudly, never fall through. Tests for all four | S |
| 3 | CX-002 | `generateText` gated at `watchOS 26.0` — wrong | ✅ REAL | [ReactWatchHost.swift:292](../js/swift/Sources/ReactWatchHost/ReactWatchHost.swift); FM is **watchOS 27.0+ (beta)** via `SystemLanguageModel` (Apple docs) | Gate → `watchOS 27.0`; keep `canImport`; implement `maxTokens`; add capability query; doc the watchOS-27-SDK build need. *Device-verify waits on Xcode 27* | S |

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
| 22 | CX-011 | Plugin doesn't remove stale `expo-target.config.js` on `widget:false` | ✅ REAL | [plugin/index.js](../js/plugin/index.js) only adds under `if(opts.widget)`; no removal | Track plugin-owned files/EAS entries; reconcile add/update/rename/remove (marker-gated) | M |
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
