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

### Session 2026-06-26 (overnight) — shipped + remaining

Shipped this batch (each its own commit, all suites green, watchOS host +
widget builds where touched):
- **CX-025** — OTA freshness on content-hash `releaseId` (same-version fixes ship).
- **ARCH-05** — atomic cross-process counter (`CoordinatedCounterStore` +
  `Storage.counterAdd`); fixes the hydration-counter lost-update between app and
  widget extension. (Root cause refined: the racer is the counter, not
  `shoppingStore` — that's single-writer.)
- **ARCH-04 slice 5** — previous-known-good OTA rollback (gate-respecting).
- **ARCH-02** — declared capability contract: `requiredFeatures` in build config,
  validated `⊆ provided` + stamped into the manifest (sound half).
- **CX-023** — the whole synchronous host bridge generated from the schema (TS
  `QuickJSHostGlobal` + Swift `HostBridge` + C trampolines + install table); all
  17 trampolines verified through a real JSRuntime in `HostBridgeTests.swift`
  (done with the owner awake, the chosen "generate typed trampolines" shape).
- **CX-012/DX-2 + DX-3 + CX-020** (the prebuild group, owner-greenlit + done with
  the build loop). **The plugin links the SwiftPM host + merges the target
  Info.plists DURING `expo prebuild`** (owner chose the internal-API route over a
  wrapper command): it registers its own custom xcode base mod after
  @bacons/apple-targets, so it runs once the targets exist (apple-targets blocks
  hooking its own beta mod — provider-must-be-last). So integration is "add the
  plugin + `react-native-watchos scaffold` (the watch `@main` glue) + `expo
  prebuild`". The expo example dogfoods the plugin (clean-room consumer). Verified
  by real plain-`expo prebuild -p ios --clean` on demo + example — watch →
  ReactWatchHost, widget → Core/Support/Runtime linked, Info.plist merged.

Held deliberately:
- **CX-013** — skip (deliberate).

- [x] **CX-001** — npm `files` allowlist + MIT LICENSE. `npm pack` 293 MB → 0.55 MB / 88 files.
- [x] **CX-014** — sensor streams reference-counted (start 0→1, stop 1→0; idempotent cleanup). +3 tests, suite 192 green.
- [x] **CX-019** — inspector poll `.catch` + stop/restart (`stopInspector`). +1 test, suite 193 green.
- [x] **OP-5** — `describe()` reads `.stack` only for real Errors (no bogus "undefined" for primitive rejections). +1 test, `swift test` 52 green.
- [x] **OP-4** — int args cross as `JS_NewInt64` (nodeId/seq beyond 2^31 no longer truncated). +1 test, `swift test` 53 green.
- [x] **CX-010 — done (both halves).** JS: `dispatchEvent` always acks the seq in a `finally` (handlerless / unknown node / throwing handler can't strand or skip-rollback an optimistic control), +3 tests. Host: `NodeView` disables a controlled input whose `onChange:true` wire flag is absent, so it can't show a value React will never accept. Verified on watchOS build.
- [~] **Foundation: ARCH-01** — feature manifest (in progress):
  - [x] slice 1 — `bridgeProtocol` structural version + per-method `feature`/`since` in `schema.mjs`, emitted by codegen (`HOST_METHODS` carries feature/since, `BRIDGE_PROTOCOL`, `RNWire.bridgeProtocol`). Drift clean, suite 196 + `swift test` 53 green.
  - [x] slice 2 — per-target feature sets generated (`HostFeatures.watch`/`.widget`, widget = strict subset) + pure `CapabilityGate.decide` (subset + bridge-protocol floor) in Support. +4 tests, `swift test` 57 green. (Generating the full Swift install *table* + trampolines from the schema = CX-023, now **DONE** — the install is no longer hand-written.)
  - [x] slice 3 — capability gate wired end-to-end. JS: `UpdateManifest` gains `requiredFeatures`/`minBridgeProtocol`; `checkForUpdate`/`fetchAndApplyUpdate` gate BEFORE download against `globalThis.__hostFeatures` (→ `appUpdateRequired`, no download/crash), +3 tests. Native: `ReactWatchHost` injects `__hostFeatures` (= `HostFeatures.watch`) + `__bridgeProtocol` at boot, **and `saveUpdate` enforces `CapabilityGate`** (UpdatePlan carries `requiredFeatures`/`minBridgeProtocol`; an incompatible bundle is refused even if signed — defense-in-depth behind the JS pre-download gate). +2 UpdatePlan tests; swift 69, watchOS build, JS 199 all green. **ARCH-01 complete.** Only ARCH-02 (build-time derivation of a bundle's `requiredFeatures`) remains as a separate item.
- [ ] **Foundation** ARCH-01 (feature manifest schema/codegen — verifiable) → ARCH-03 (app/widget bundles) → ARCH-04 (transactional OTA); absorbs CX-002/CX-003/CX-004/CX-007
- [x] **SD-2 / CX-018 — interpreter drift fixed** (shared-parsing approach):
  - [x] slice 1 — pure style helpers in Support (`RNStyle`: hex color → rgba, semantic font, value/timer formatting). +6 tests, `swift test` 63 green.
  - [x] slice 2a — `NodeView` resolves color/font/format via `RNStyle` (deleted duplicate `hexColor`). Verified: `xcodebuild -scheme ReactWatchHost -destination watchOS Sim` = BUILD SUCCEEDED.
  - [x] slice 2b — `WidgetNodeView` resolves via `RNStyle` too → **gains hex colors + monospacedDigit** (the actual CX-018 drift). Verified: `xcodebuild -scheme "React Watch Widgets"` = BUILD SUCCEEDED.
  - Note: full one-file unification (RenderContext/adapter, ARCH-10) is a further optional refactor; the drift itself is gone since both interpreters share `RNStyle`. (timer-ms stays intentionally degraded in widgets — WidgetKit can't tick at 50ms.)
- [x] CX-016 — pure `WidgetSnapshot.currentIndex` (latest entry ≤ now, else earliest) in Support (+4 tests, `swift test` 67); `ReactTimelineProvider.latestEntry` now uses it instead of `.entries.last`. Verified: `xcodebuild -scheme "React Watch Widgets"` = BUILD SUCCEEDED.
- [x] CX-015 (Map camera — SwiftUI), CX-017 (relevantContexts — WidgetKit API): host/Xcode. SD-1/SD-6 bridge+codegen (CX-022/023/024) — this grouping row is fully absorbed: every ID in it now has its own ✅ entry in this list (CX-015, CX-017, CX-022, CX-023, CX-024).
- [~] Phase 4 DX (CX-011/012/020 + DX-1..7), Phase 5 — partial:
  - [x] **CX-011** (`widget:false` convergence) — see its verdict row.
  - [x] **DX-6** (typed connectivity contract) — `defineMessages<T>()` wraps `sendToPhone`/`onPhoneMessage` into typed `send`/`on` over one shared `T` (`{ type, payload }` envelope, `on` dispatches by type). +2 tests (JS 232). The both-sides *example* (iPhone companion using the same contract) still needs the companion app + a device.
  - [x] **CX-012/DX-2 + DX-3 + CX-020 — DONE** (prebuild group). **CX-012: the plugin does the SwiftPM link + Info.plist merge IN-prebuild** via its own custom xcode base mod (`plugin/withNativeWiring.js`), registered after @bacons/apple-targets so it runs once the targets exist — `expo prebuild` alone fully wires, no `postprebuild`, no wrapper command. (Initially shipped as a `react-native-watchos prebuild` wrapper, then reversed at the owner's request to the Expo-native internal-API route.) `react-native-watchos scaffold` (DX-3) generates the watch `@main` Swift glue from the plugin's resolved app.json config. CX-020: the expo example dogfoods the plugin + scaffold + plain `expo prebuild`; dropped `"type":"module"`, README rewritten, generated target files gitignored. Verified by real plain-`expo prebuild -p ios --clean` on demo + example: watch → ReactWatchHost, widget → Core/Support/Runtime linked, Info.plist merged. +2 scaffold + 2 merge tests (JS 250).
  - [x] **DX-1 + DX-4 — DONE.** DX-1: the minimal-watch-app README's `file:`/`workspace:*` text was already consistent; added a cross-reference so readers pick the right shape (Expo → the plugin + `expo prebuild` via `../expo-watch-app`; this minimal example = the non-Expo, hand-wired JS-bundle path). DX-4: `resolveSwiftPackage` already resolves the SwiftPM ref to `node_modules/react-native-watchos/swift` via `require.resolve` (verified by the prebuild runs); added a packaging test that runs `npm pack --dry-run --json` and asserts the published tarball ships `swift/Package.swift` + the `swift/Sources` (incl. ReactWatchHost) + the plugin (incl. `withNativeWiring`) + the CLI, and excludes `swift/.build`. +2 packaging tests (JS 252).
  - [x] **Widget + OTA consumer DX — DONE (2026-06-26).** Three owner-greenlit fixes so a consumer doesn't copy Swift or reverse-engineer OTA:
    - **Widget packaging + scaffold (#1):** the generic WidgetKit infra (node interpreter, timeline providers, relevance/control helpers, the extension's QuickJS runtime) moved out of the demo's widget target into a new macOS-gated **`ReactWatchWidget`** SwiftPM module — `appGroupId`-threaded, no globals, `#if os(watchOS)` so `swift test` still runs on Linux. The demo widget target now consumes it (≈625 lines deleted), and `react-native-watchos scaffold` generates `targets/widget/ReactWidgets.swift` (the `@main WidgetBundle`) just like `WatchApp.swift`. `SharedWidgetStore.loadPublishedWidgets()` added (Linux-tested). WIDGET_PRODUCTS → `[ReactWatchWidget, ReactWatchCore]`. Verified: `ReactWatchHost-Package` builds the module for watchsimulator26.2; the plugin links it into the generated widget target (pbxproj); hermetic `swiftc -typecheck` of the demo widget sources + the scaffold template against the built modules + watchOS SDK passes. (Full embedded-app xcodebuild blocked by a pre-existing hermes-for-watchOS pod-graph issue, unrelated.)
    - **OTA build helper (#2):** `writeOTAManifest` published as `react-native-watchos/manifest` (computes the `releaseId` content hash + stamps `requiredFeatures`/`minBridgeProtocol`); the package build dedupes through it.
    - **Demo OTA in the example (#3):** expo-watch-app gains a "Check for update" button, `build-watch.mjs` stamps the manifest + bakes `REACT_WATCH_OTA_URL`, and `ota:serve` statically serves the assets for the simulator demo.
  - [x] **DX-7 full smoke — DONE (2026-06-27).** Verified the *published* artifact end to end from outside the workspace: `npm pack` → extract the example's git-tracked files to a fixture outside the pnpm workspace → swap `react-native-watchos: workspace:*` for `file:<tgz>` → `npm install` (real dep, no symlink) → `build:targets` (both bundles + OTA manifest from the installed package) → `expo prebuild` (plugin links ReactWatchHost/ReactWatchWidget/ReactWatchCore, SwiftPM resolved from `node_modules/react-native-watchos/swift`) → pods clean → **`xcodebuild -scheme "Expo Watch" -destination 'id=<watch sim>'` BUILD SUCCEEDED**, compiling the watch host, the `ReactWatchWidget` package module, and the embedded widget extension (`ReactWidgets.swift`) for watchOS with no errors. Build the **watch app scheme against a concrete watch sim** (not the widget scheme with a generic destination — that one fans arches and drags hermes-for-watchOS). The earlier "deferred heavy CI job" is now a known-good local recipe.
    - **CX-012/DX-2 — the in-prebuild hook (confirmed 2026-06-26):** @bacons/apple-targets injects its targets through its OWN `xcodeProjectBeta2` base mod and registers its mod + the base-mod *provider* atomically; Expo forbids adding a mod after a provider ("provider must be last"), so `withXcodeProjectBeta` can't be hooked to run after apple-targets' injection. The working route is the SAME mechanism apple-targets uses: register our OWN custom base mod via `withGeneratedBaseMods` AFTER apple-targets (base mods run in registration order), re-open the .pbxproj with the proven `wireLocalPackage`, and link. Couples to apple-targets' base-mod ordering on purpose (owner-chosen); the in-prebuild step is try/caught (never fails prebuild) and the standalone link/merge scripts remain as manual fallbacks.
- [x] Host fixes (written + **verified on a watchOS build** — Xcode is available here): **CX-009** (reject a wire-mismatched commit before it reaches the interpreter or advances the ack), **OP-3** (cap app QuickJS heap at 64 MB), **OP-6** (stable Map annotation id).
- [x] CX-015 — Map `latitude`/`longitude`/`span` props now drive `Map(initialPosition: .region(...))` (were ignored); `.automatic` fits annotations when absent. Verified on watchOS build.
- [~] **ARCH-04** (transactional OTA state machine):
  - [x] slice 1 / **OP-1** — bytecode cache keyed to a source `ContentHash` in `OTAMeta`; `evaluateOTA` trusts the `.qbc` only on a hash match, so a crash mid-apply or a stale cache can't run old code as if it were this bundle. +1 test (swift 70), watchOS BUILD SUCCEEDED.
  - [x] slice 2 — **read-only validation**: `persistOTA` evals the candidate in a throwaway runtime (host callbacks nil → no-op commit/setItem/publish) and refuses to persist a bundle that throws on load, so a bad bundle is never saved and can't partially mutate storage during the check. +1 test (swift 71), watchOS BUILD SUCCEEDED.
  - [x] slice 3 — **crash-loop boot rollback**: `SharedWidgetStore.otaBootAttempts` counts boots that ran the OTA bundle but never reached a healthy commit; `load()` increments before eval and rolls the bundle back (drop + shipped) once it hits `maxOTABootAttempts` (3); `onCommit` resets the counter on the first committed tree. Catches the *native*-crash case the JS-throw fallback can't (process dies before the catch). +3 store tests (swift 74), watchOS BUILD SUCCEEDED. Counter/decision are unit-verified; the rollback *trigger* (an actual native boot crash) is compile-verified only — needs an on-device crash scenario to exercise end-to-end.
  - [x] slice 4 — **atomic apply**: source + version/signature/bytecodeHash collapse into one `OTARecord` (Support, shared/testable) written with a single atomic `JSONEncoder` write — the commit point. Replaces the old two-file (`.js` + `.json`) write whose crash window could pair a new source with a stale version/signature. Bytecode `.qbc` is now pinned by `ContentHash.of(blob)` (the blob's own hash, not the source) so a stale/partial `.qbc` is never trusted. +5 tests (OTARecord round-trip, `ContentHash.of(Data)`; swift 77), watchOS BUILD SUCCEEDED.
  - [x] **CX-007 — signing `keyId`/rotation**. The signed message is now `"v1:<keyId>:<version>:<js>"` — the `keyId` is bound *inside* the signed bytes, so it can't be swapped to steer the host to a different key (the JWT `kid`-confusion failure mode). `OTAConfig.publicKeyBase64` → **`signerPublicKeys: [keyId: base64]`** (a trusted-key map shipping inside the code-signed binary); verification looks the `keyId` up and **fails closed** on an unknown id. Rotation = trust `{old,new}` then drop `old` in a later release (rotate-then-revoke overlap window, documented in `ota-signing.md`). `keyId` charset is colon-free (`UpdatePlan.isValidKeyId`, enforced on the **verifier**) so the `:`-delimited message stays injective. Threaded through `ota-keygen` (emits a kid + paste-ready map literal), `ota-sign` (`OTA_SIGNING_KEY_ID`, writes `keyId` to the manifest), `UpdateManifest`/`applyUpdate`/`fetchAndApplyUpdate`, `RemoteManifest` native recovery, and `OTARecord` (audit field). Tests: regenerated Node↔CryptoKit interop vector (now kid-bound, + a swapped-kid-fails assertion), `isValidKeyId`, `signedMessage` colon/nil cases, OTARecord round-trip, JS payload threading. Verified: JS 212, `swift test` 80, **watchOS BUILD SUCCEEDED**, keygen+sign round-trip smoke. Design sanity-checked against expo-updates/JWT/TUF (bind-kid + fail-closed + overlap-window confirmed).
  - [x] slice 5 — **previous-known-good rollback** (was deferred; now done). On the first healthy commit the running OTA record is snapshotted as a known-good (`ota-bundle.good.json`/`.qbc`); when a bundle crash-loops, `load()` now prefers restoring that known-good over dropping all the way to shipped — but **only when it still satisfies anti-rollback**. The sound rule is a pure `VersionPolicy.crashLoopRecovery` (Support, unit-tested): roll back ⟺ a known-good exists, differs from the failing bundle (else it would loop), and — when enforcing — `decide(otaVersion: goodVersion, …) == .runOTA` (so an older-schema known-good is NOT run over a newer-schema db; that correctly falls through to shipped + the hard gate). Restoring sets bootAttempts=1, so if the restored bundle also crash-loops it terminates at shipped next time (knownGood == active). The common win is a same-version non-breaking fix (CX-025 releaseId) that crash-loops → back to the last working build instead of the much older shipped one. +5 recovery tests (`swift test` 95), watchOS BUILD SUCCEEDED. As with slice 3, the decision/promotion/restore are unit+compile-verified; the actual crash *trigger* is on-device-only.
- [x] **CX-021** (`fetch` — honest WHATWG *subset*). Done as one change after owner direction (don't over-restrict, don't fake API the host can't honor):
  - **No JS scheme gatekeeping.** The native `FetchPlan` + URLSession are the single URL authority — they accept any *absolute* URL and reject the rest. So any scheme (incl. a custom app scheme like `xapp://`) passes through verbatim and works iff URLSession supports it; JS no longer pre-restricts to http(s). (An earlier http(s)-allowlist slice was reversed here — it duplicated native validation and blocked schemes native would attempt.)
  - **Single-use body** (`bodyUsed`; first `text()`/`json()`/`arrayBuffer()` consumes, second rejects with `TypeError`).
  - **Honest header**: documents the supported subset and what's *intentionally not* implemented (`Request` input, `clone`, `credentials`/`cache`/`redirect`, `Blob`/`FormData`) — the host can't honor them, so adding them would be the false "WHATWG-aligned" claim the review flagged.
  - TDD: JS passthrough test written red → green; Swift `FetchPlanTests` gained "any absolute scheme accepted" + "schemeless rejected" to lock the native contract. JS suite 201, `swift test` 79, typecheck + biome clean.
- [x] **ARCH-03** — **separate app & widget bundles** (build-only; CX-004 deepened). `demo/entry.tsx` split into `app.entry.tsx` (mounts UI + seeds/syncs complications) and `widget.entry.tsx` (registers intent + timeline handlers only — no `App` import, no `runApp`). Build emits two bundles: the app keeps the name `dist/bundle.js` (dev server, OTA manifest, dev-fetch URL unchanged) and the new `dist/widget.bundle.js`; each copies to `bundle.js` in its target dir, so **no Swift change** (native loads the resource named "bundle" from its own target). The widget process no longer evaluates app code — minified widget 143 KB vs app 171 KB. Per-target size budgets (app 200 / widget 160) + bytecode tooling now cover both. The `qjs-smoke` intent run loads the **widget** bundle with a `commit`-throws guard, proving it never mounts UI. JS suite 201, widget Xcode scheme BUILD SUCCEEDED. (OTA-side dual-bundle release = SD-4, separate.)
- [x] **CX-008 / SD-5** — **generation token on reload**. `boot()` reset the id space (`nextSeq`, JS fetch/generate ids) and dropped the runtime but never cancelled in-flight async, so a late fetch/generate callback could settle the WRONG pending request in the fresh runtime (id reuse). Added a `generation` counter bumped each boot; the two id-carrying async paths (fetch completion, FoundationModels generate) capture it and drop their result if it no longer matches. `boot()` also cancels outstanding `fetchTasks` and calls a new `SensorBridge.stopAll()` so stale streams don't push into the new runtime. BLE is intentionally left connected (stateful link, not worth dropping on a dev hot-reload; its events are name-routed, not id-keyed). watchOS BUILD SUCCEEDED. (OP-2 main-thread assert + full RuntimeSession isolation = ARCH-08, later.)
- [x] **CX-005** — **applyUpdate reports the watch's verdict**. It was fire-and-forget (`void`), so a rejected OTA (bad signature, capability gap, downgrade, write failure) vanished. `applyUpdate` now returns `Promise<SaveUpdateResult>` that *resolves* `{accepted}` (never throws); a refusal comes back `{accepted:false, code, message}` with the native reason. Wired with the existing per-op `__resolve*/__reject*` convention (consistent with fetch/generate): `saveUpdate(id, json)` on the bridge, `resolveSaveUpdate`/`rejectSaveUpdate` settling on the main thread; `fetchAndApplyUpdate` returns `null` when the watch refuses a downloaded bundle. +2 OTA tests incl. the rejection path (JS suite 202), `swift test` 79, watchOS BUILD SUCCEEDED. **SD-1's *generic* `invoke` channel deferred** — moving `saveUpdate` out of `hostMethods` would drop the `ota` feature from the ARCH-01 taxonomy, a design fork worth its own pass; per-op pairs match the codebase today.
- [x] **CX-022** — typed results for silent fallible native ops (code-complete; the BLE ops' ③ device-verify is the one open slice):
  - [x] **notification permission** — was fire-and-forget (`requestAuthorization { _, _ in }`, result dropped). `requestNotificationPermission()` now returns `Promise<NotificationPermission>` (`granted | denied | notDetermined | provisional | unavailable`), settled via `resolveNotificationPermission`/`rejectNotificationPermission` (per-op pair, like CX-005). The host resolves from `getNotificationSettings().authorizationStatus`, **not** the raw granted `Bool` — `.provisional` silently returns `granted == true`, so a Bool would mislabel a quiet-only grant (research-driven). Completion marshalled to main + generation-guarded (CX-008); native error → reject. +3 JS tests (suite 204), `swift test` 79, ReactWatchHost BUILD SUCCEEDED.
  - [x] **SD-1 generic `invoke` channel** — replaced the per-op pairs with one `__host.invoke(id, method, payloadJson)` settled by `__resolveInvoke`/`__rejectInvoke` (`js/src/invoke.ts`): one correlation-keyed pending map, a single `settle()` that deletes-then-settles (settle-exactly-once), a closed-enum error `code` (`UNKNOWN_METHOD`/`PERMISSION_DENIED`/`UNAVAILABLE`/`INVALID_REQUEST`/`INTERNAL`), and an unknown method **rejects** (never hangs). **saveUpdate + requestNotificationPermission migrated onto it** (their dedicated host methods + `__resolve*/__reject*` bridges removed). Taxonomy preserved without two lists: schema keeps one `hostMethods` with a `via:"invoke"` flag → features still derive from it (ARCH-01 unchanged), and the cross-check test now verifies *direct* installs **and** that the host routes every `via:"invoke"` method. fetch/generate stay dedicated (abort/streaming), sensor/BLE keep the push channel, no cancellation in v1 — all per research (Capacitor/RN/TurboModule prior art). +invoke.test (suite 209), `swift test` 79, ReactWatchHost BUILD SUCCEEDED, swift lint clean.
  - [x] **connectivity send** — `sendToPhone(message)` was fire-and-forget (`sendMessage(replyHandler:nil, errorHandler:nil)`, falling back to a silent `updateApplicationContext` when unreachable). Now returns `Promise<reply>` over invoke: `PhoneConnectivity.send` uses `sendMessage` with reply/error handlers, resolves the phone's reply, and rejects (with an InvokeError `code`) when not reachable or on a `WCError` (mapped to the closed enum; detail in `message`). Handlers fire on a background queue → marshalled to main + generation-guarded (research-driven). +connectivity tests updated (suite 209), `swift test` 79, ReactWatchHost BUILD SUCCEEDED, swift lint clean.
  - [x] **scheduleNotification** migrated onto invoke (commit `7c76117`): returns `Promise<ScheduleNotificationResult>` so an `add` failure reaches JS instead of clobbering `runtimeError`. The owner's sync-id concern is kept — the deterministic id is always in the result, the demo (explicit id, ignores return) is unaffected. JS 217, swift test 80, watchOS BUILD SUCCEEDED.
  - [x] final op — **BLE connect/write/subscribe — SHIPPED in code** per the design ([design-ble-result-reporting.md](./design-ble-result-reporting.md)): `bleConnect`/`bleWrite`/`bleSubscribe` return Promises over invoke; the id↔result correlation lives in the pure `BleSession` ("invoke result correlation (CX-022)" section, Linux-`swift test`ed) — connect resolves on the FIRST connect only, `.withResponse` writes settle on the added `didWriteValueFor` delegate (FIFO per characteristic), `.withoutResponse` resolves optimistically with a documented caveat, subscribes settle on `didUpdateNotificationStateFor` — while CoreBluetooth I/O stays in the bridge. The 2026-07-08 perf audit then bounded the auto-reconnect these promises interact with (5×60s, tunable, `0` disables). JS: bluetooth suite green; the design note's first three acceptance boxes are ticked. **Remaining slice: ③ device verification only** — connect/drop/reconnect/write-ack/subscribe against a real peripheral (the watchOS simulator has no Bluetooth radio).
- [x] **CX-024 / SD-6** — **component contract + interpreter drift guard**. `schema.mjs` now declares `components` (the 25 primitive types + each one's widget support: `full | degraded`) as the single source of truth, generated to a `COMPONENTS` TS const. `component-contract.test` asserts BOTH SwiftUI interpreters (`NodeView` app + `WidgetNodeView` widget) handle *exactly* the contract — catching the CX-018 drift class (a primitive handled in one and silently dropped in the other) at test time. (Research flagged a typed `Record` for compile-time exhaustiveness, but our interpreters are Swift switches that must keep a `default:` for forward-compat, so the parse-the-cases test is the right tool here.) JS suite 212, drift + typecheck + biome clean.
- [x] **UI**: unsupported node types now log (done, `9d1d330`).
- [x] **CX-027 — docs: split verified status from plan**. New [status.md](./status.md) is the single evidence-backed "is it real yet?" view — a maturity-tiered capability matrix (① logic-tested / ② builds-for-watchOS / ③ device-verified / ⛔ blocked, each level naming its mechanical check), every row linked to a test/build. Corrects the two flagged overclaims: **on-device AI** = ⛔ blocked (gated `watchOS 26.0` but Foundation Models is `27.0+`, fix unshipped + Xcode-27-gated — CX-002), and **`relevantContexts`** = partial (ranking ② wired, predictive surfacing decoded-not-applied — CX-017). `roadmap.md` keeps its history but now defers to status.md (top banner) with both overclaims fixed inline; indexed in `docs/README.md`. Design checked against Rust target-tiers / repostatus / Keep-a-Changelog (tense-ownership: roadmap=future, status=falsifiable-now, "blocked" stays in the matrix, "planned" stays out). README/publishing carried neither overclaim.
- [x] **ARCH-05 — cross-process lost-update fixed** (atomic counter primitive). The real racer wasn't `shoppingStore` (single-writer: only the app mutates lists) but the **hydration counter** — `hydration.glasses` is read-modify-written by **two processes**: the app's "Add glass"/"Reset" buttons and the widget extension's `addGlass` control. `Storage.get + 1 + set` over App-Group UserDefaults loses concurrent increments (no atomic cross-process RMW). New framework primitive: `CoordinatedCounterStore` (Support, Foundation) does a clamped read-modify-write under one `NSFileCoordinator` **write claim** against a per-key file in the App Group — the only primitive that serializes a whole RMW across processes on watchOS (fresh coordinator per op, no filePresenter; gated `#if canImport(Darwin)` with a plain-file fallback so Support still builds + `swift test`s on Linux). Two synchronous host methods `counterGet`/`counterAdd` (schema `feature:"storage"`, since 1, both targets — no new capability) thread through the bridge exactly like get/set; JS `Storage.counterValue`/`counterAdd` (+ memory fallback) back a rewired `hydrationStore.addGlasses(delta)`. Reset = a delta that underflows the floor (`-goal`), so no third "set" op. App `HydrationScreen` and the `addGlass` intent both call the atomic add. +6 Swift counter tests (`swift test` 90), +3 JS storage tests + updated qjs-smoke counter mock (JS 242), codegen cross-check auto-covers the two new installs, typecheck/biome/swift-format clean, **watchOS host build + widget extension build both SUCCEEDED**. The clamp/persist/accumulate logic is unit-verified single-process; the cross-process *atomicity* itself is the documented `NSFileCoordinator` guarantee (device-only to exercise the actual two-process race). `dataSchemaRange` on the release contract stays deferred (the lost-update — the live correctness gap — is closed; a full migration engine is not needed pre-release).
- [x] **ARCH-02 — declared capability contract (sound slice).** Each bundle now declares its `requiredFeatures` in `scripts/config.mjs` (`app` = storage/widgets/haptics/bluetooth/ai/network/ota/connectivity/notifications; `widget` = storage/widgets), tagged with the native `schemaTarget` it runs on. The build (`build.mjs`) **validates `declared ⊆ provided`** via the pure `releaseContract.mjs` helpers (a target can't declare a feature its binary doesn't install — catches a typo, or the widget asking for a watch-only feature) and **fails loud** before building; it then **stamps `requiredFeatures` + `minBridgeProtocol` into `dist/manifest.json`**, so `checkForUpdate`/`fetchAndApplyUpdate` gate OTA without the publisher hand-passing them (`ota-sign` read-modify-writes the manifest, preserving the fields). +4 contract tests (JS 246), typecheck/biome clean, manifest verified end-to-end (real `node scripts/build.mjs` stamps the 9 features + `minBridgeProtocol:1`). **Deliberately NOT done — the unsound half:** auto-checking `declared ⊇ used` (that a bundle declared every feature it *calls*). The bundle imports the whole framework and capability modules self-register, so import/usage scanning over-approximates and isn't a sound authority; under-declaring stays the developer's responsibility (documented in `releaseContract.mjs`). No native change (Swift `RemoteManifest` ignores the new keys; `saveUpdate` stays the enforcement point).
- [x] **CX-023 — host bridge generated end-to-end** (owner-greenlit, "generate typed trampolines"). The synchronous `__host` surface is now single-source: each direct method declares `args`/`returns` in `schema.mjs`, and codegen emits the TS `QuickJSHostGlobal`, the Swift `HostBridge` callback struct, the C trampolines (arg marshaling by type + return marshaling), and the install table into `Generated/HostBridge.swift`. JSRuntime collapses the 14 `on*` host-method props into one `var bridge = HostBridge()` (host sets the feature closures; JSRuntime sets the infra setTimer/clearTimer/log defaults), and the hand-written trampolines + `fromC` layer + install block are deleted (`from(context:)` widened to internal so the generated file can reach it). `onError` stays (it's Swift→host, not a JS-called host method). The host wiring moved `js.onGetItem` → `js.bridge.getItem` across ReactWatchHost/IntentRuntime/tests (breaking, pre-release OK). **Why C trampolines at all:** QuickJS is a C lib + Swift `@convention(c)` can't capture, so a trampoline that recovers the runtime from the context pointer + marshals is mandatory; we keep them *typed* (vs one generic JSON bridge) for sync returns (getItem/counterAdd) + hot-path perf, and generation removes the maintenance cost. **Per-method test:** `HostBridgeTests.swift` drives all 17 trampolines through a real JSRuntime (real quickjs + the generated C) — args-in for each, value-out for getItem/counterGet/counterAdd, plus an install-completeness check — so a marshaling bug can't pass "it compiles" (the gap the owner flagged). Bonus: generating dropped a real drift — the hand-written TS type still listed `scheduleNotification`, a via-invoke method. Verify: swift test 105 (+10), JS 246, codegen no drift, typecheck/biome/swift-format clean, watchOS host + widget builds SUCCEEDED.
- [x] **ARCH-13 — structured diagnostics + operating budgets (2026-07-16).** The last-write-wins `runtimeError`/`startupError` strings are replaced by a structured `Diagnostic` record (code, severity, subsystem, sessionId, releaseId, target, timestamp, userAction, details) in ReactWatchSupport (not Core — WireModel.swift is codegen-owned; TODO(codegen) marks folding it into schema.ts), with an always-on 50-entry ring (release too, for OTA-rollback forensics), a pluggable `DiagnosticsSink` + os.Logger default, and one `report()` write path converting every host write site (severity policy: fatal = boot.startupFailed/wire.versionMismatch → the existing full-screen path via a derived `startupError`; recoverable → the tap-dismiss banner; info → ring/log only; `updateRequired` stays a state flag). `JSRuntime.onError` now tags its source (`eval|call|job|promiseRejection`, pre-release break); the widget's print error sink became os.Logger. Operating budgets (`BudgetPolicy` native / `budgets.ts` JS — maxNodes 1000, maxCommitJSONBytes 256 KB, maxWidgetRenderMs 500 ms; no commit-rate budget in v1) WARN once per crossing (hysteresis) and never reject a commit (CX-010). Exposure: a `diagnostic` native event over the existing push channel (js-subsystem records excluded — echo-loop protection), typed `onDiagnostic()` export, and the inspector snapshot gains a `diagnostics` ring when started (native ring always-on; JS exposure stays DEV/opt-in). NOT a metrics system — startup time/heap stay on the boot Logger. Verify: swift test 227 (+12), JS suite 410 (+9; green except the env-only codegen-drift swift-format skip), typecheck/biome clean; host/widget Swift is watchOS-only → compile-verified on the next Mac build. Budgets doc rows #12–14.
- [x] **ARCH-14 — isolate the reconciler surface (2026-07-17).** `js/src/reconcilerAdapter.ts` is now the ONLY module importing `react-reconciler`/`react-reconciler/constants` (boundary CI-guarded, same pattern as ARCH-02's `__host` rule): it exports the fully-typed surface — `WatchHostConfig<Type,Props,Container,Instance>` (the host-config contract react-reconciler@0.33 ACTUALLY calls, verified member-by-member against the shipped cjs builds), a `WatchReconciler` handle (`createContainer` with the concurrent-root policy baked in, `updateContainerSync`, the flushes, `injectIntoDevTools`), and the priority constants re-typed as `EventPriority` — and holds the package's **single documented unsafe cast** (the factory bridge). `renderer.ts` lost its `as never` + `as unknown as` blocks and the `console` cast; its `hostConfig` is now *annotated*, so tsc proves the contract exactly (no missing/extra/drifted member). Root cause documented: `@types/react-reconciler@0.32` vs runtime 0.33 — the types require members 0.33 dropped, lack members 0.33 reads, declare `injectIntoDevTools(config)` where 0.33 takes NO args (the old code passed a dead config object; DevTools identity really comes from hostConfig's `rendererVersion`/`rendererPackageName`), and ship stale lane VALUES (Discrete/Default 1/16 vs runtime 2/32). Full drift list, tested matrix and upgrade procedure: [reconciler-version-matrix.md](./reconciler-version-matrix.md). `test/reconcilerAdapter.test.ts` = the upgrade fixtures: import-boundary sweep, exact-pin assertions (peer+dev `react-reconciler 0.33.0`, `@types ^0.32.0`, `react ^19.2.0`), runtime lane-value pins. Dependency ranges deliberately unchanged — the exact peer pin is what guarantees only matrix-tested versions install while the cast blinds tsc; NF-36's `~0.33.0` + dual-copy-assertion idea is recorded in the matrix doc as the revisit path. Pure typing/boundary refactor, zero behavior change. Verify: JS suite 413 (+3; green except the env-only swift-format codegen skip), typecheck/biome clean, build + `tools/embed-smoke` green (heap 2.1 MB, boot 43 ms, dispatch/nav transaction on real quickjs-ng incl. the bytecode path).
- [x] **ARCH-09 — JS-confirmed lazy navigation (2026-07-16).** The nav transaction shipped in three layers (`7348622`/`905240f`/`1c1813b`/`23147c5`): (1) `dispatchEvent` returns a structured **`DispatchResult {handled, accepted, reason?}`** instead of a discarded bool — for `pathChange`, `accepted` is a POST-FLUSH comparison of the stack node's committed `path` prop against the proposal (a controlled `onPathChange` folds the path synchronously; the CX-010 dispatch flush commits it before the comparison), and the CX-010 seq-ack `finally` is untouched. (2) Swift reads the verdict via a new returning dispatch and `RoutedNavigationStack` **confirms-then-animates**: pushes/replaces propose the path and hold it in the OptimisticStore only on accept — a decline / missing handler / thrown handler animates nothing (pops stay always-accepted notifications; the native back gesture already happened). (3) JS mounts **only the winning routes** (memoized `StackWinners` context: root + every entry of the active path), so inactive screens are neither mounted nor serialized — BREAKING: screen-local state drops on pop, and inactive-screen effects must use `useFocusEffect` (already the documented pattern). Measured payoff on the vendored-engine bench (`2911e73`): launch tree **152 → 48 nodes / 13.4 → 4.1 KB**, perDispatch **1.32 → 0.518 ms**; embed-smoke gates green (heap 2.1 MB, boot 39.9 ms, `.qbc` interaction path). Verify: navigation suite 27/27 pinning the LAZY contract, qjs-smoke pins lazy-at-launch / mount-in-the-confirming-dispatch / covered-stack-stays-serialized / pop-unmounts in the real engine, swift test 215/215. The Swift halves are watchOS-only → compile-verified at the next Mac build; on-device transition latency still owed.
- [x] **ARCH-12 — WatchConnectivity split by delivery semantics + background channels (2026-07-16).** The 07-04 review's "week-1 wall" (the only phone channel was `sendMessage`, which needs a REACHABLE iPhone) is closed (`690b4f4` + `7bab0fc`). Outbound: `updateApplicationContext(context)` (latest-wins state, delivered when the phone wakes; resolves on hand-off) and `transferUserInfo(userInfo)` (FIFO queue surviving suspension; resolves once queued), both over the generic invoke channel with a shared validated-session preamble in `PhoneConnectivity`. Inbound: one `onPush(event:payload:)` wiring splits `watchConnectivity` / `.applicationContext` / `.userInfo` (+ the previously-missing `didReceiveUserInfo` delegate), surfaced as `onApplicationContext`/`onUserInfo` — BREAKING: phone-pushed context no longer arrives on `onPhoneMessage`. The connectivity module doc tables the three channels' guarantees; the schema↔router drift test caught the two missing `via:"invoke"` entries and they're declared (`7bab0fc`). Verify: connectivity suite 7/7 (invoke threading + a channel-isolation test), typecheck/biome clean, Linux swift build clean; `PhoneConnectivity` is watch-only → the delegate halves await the next Xcode build, and the paired-device exchange stays ③.
- [x] **ARCH-07 — HostPolicy: authorization separate from availability (2026-07-17).** A consumer now states least privilege once — `ReactWatchRootView(policy: .allow([...]))` / `ReactWatchWidgetOTA.configure(policy:)` (default `.allowAll`) — and the same **effective set** (policy ∩ native, `"core"` force-kept) drives every layer (`d928925`/`436f343`/`3ff9d13`/`283bbbc`/`c2abd25`/`952d7bb`/`32df8b7`): codegen wraps the generated install table in per-feature guards (`installHostBridge(allowedFeatures:)`; core unconditional), so a denied feature is never installed on `__host`; `__hostFeatures` publishes the effective set, so the JS pre-download OTA gate obeys policy with zero JS changes; the invoke router rejects denied methods with the new typed `POLICY_DENIED` ("requires an app configuration change" — deliberately never "update the app") via the generated `HostInvokeFeatures.byMethod` map; OTA staging adds a second, separate check AFTER CapabilityGate (capability wording wins on a double failure — commented + tested) and the OTA validator runtime validates under the effective set too; and the widget's pre-existing sharp edge is fixed on the way — its `bridge.invoke` now rejects fast + typed (UNKNOWN_METHOD/UNAVAILABLE/POLICY_DENIED) instead of hanging into the 30 s watchdog. Authorization (`HostPolicy.Decision.denied(byPolicy:)`) stays a distinct type from compatibility (`CapabilityGate.Decision`), per the review's acceptance. Verify: swift test 238 (+11: HostPolicyTests, HostBridge policy filtering in a real runtime, OTA policy staging), JS 418 (codegen guard-coverage + invoke-map ≡ schema, `POLICY_DENIED` typing, policy-shrunk `__hostFeatures` OTA tests), codegen regenerates byte-identically, embed-smoke green; the host/widget halves are watchOS-only → compile-verified at the next Mac build (`swiftc -parse` clean here).
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
- **SD-3 metafile → explicit declared contract (ARCH-02).** 🔧 **sound slice
  DONE** (see build log). *Correction:* `esbuild/preset.mjs` does **not** emit a
  metafile (my note was wrong), and import-presence isn't a sound authority
  anyway. The bundle **declares** its features; generated wrappers/primitives
  emit stable markers; **static analysis is a build CHECK that fails loud on an
  undeclared capability** (so it still can't be silently forgotten) — not the
  signed authority. **What shipped:** the declarative side — each bundle declares
  `requiredFeatures` in `scripts/config.mjs`, the build **validates `declared ⊆
  what that target's binary provides`** (the sound check, catches a typo or a
  widget asking for a watch-only feature) and **stamps them + `minBridgeProtocol`
  into the OTA manifest**, so the ARCH-01 gate works without the publisher
  hand-passing them. **Still open (the unsound half):** `declared ⊇ used` — auto-
  detecting that a bundle declared every feature it *calls*. Import/usage scanning
  over-approximates (the bundle imports the whole framework; capability modules
  can self-register), so under-declaring stays the developer's responsibility;
  it's documented in `releaseContract.mjs`, not silently assumed sound.
- **"No DB" was too strong (ARCH-05).** ✅ **DONE** (see build log). *Correction
  refined during implementation:* the lost-update racer is the **hydration
  counter**, not `shoppingStore` — only the app mutates the shopping lists
  (single-writer), whereas `hydration.glasses` is incremented by **both** the app
  and the widget extension's `addGlass` control. A `revision`/CAS over a
  non-atomic store can't be made correct (the read and the compare-write aren't
  one operation across processes); the sound fix is an `NSFileCoordinator`
  write-claim wrapping the whole read-modify-write — shipped as
  `CoordinatedCounterStore` + `Storage.counterAdd`. `dataSchemaRange` on the
  release contract stays deferred (no migration engine needed pre-release).
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
  *(Shipped 2026-07-17 — see the build-progress log entry above.)*
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
| 9 | OP-2 | No main-thread assertion on JS settle calls (latent heap corruption) | ✅ **DONE** | doc said main-only, nothing enforced | `assertMainThread()` (DEBUG `assert(Thread.isMainThread)`, names the caller via `#function`) on every JS-touching bridge method — the 6 Promise settles + `pushNativeEvent` + `dispatchEvent`. **Audited every caller on-main** (the other half of the rec): connectivity + sensors hop explicitly, BLE central uses `queue: nil` → main, UI/scenePhase/openURL are SwiftUI-main — so **no current off-main bug**, and a future regression traps in DEBUG. `swift test` 84, watchOS BUILD SUCCEEDED. (Full RuntimeSession isolation = ARCH-08, still separate.) | S |
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
| 17 | CX-007 / CX-025 | Version is both rollback gate AND freshness → non-breaking fixes never ship | ✅ **DONE** | was: `update.ts` freshness on `version` | Both shipped. CX-025: freshness now keys on a content-hash **`releaseId`** (build stamps `manifest.releaseId` = FNV-1a of the app bundle; host exposes `__bundleReleaseId` for the loaded bundle on both shipped + OTA paths; `checkForUpdate`/`fetchAndApplyUpdate` use `isFresherRelease` — same-version-new-content ships, a downgrade never does). `version` stays the anti-rollback gate. Cross-language hash verified **end-to-end** on the real bundle (`4f35d5c30fa5340` from both JS build + Swift). +6 tests (content-hash vectors, same-version-diff-releaseId, match=no-update, downgrade-never, stage-fix). JS 239, swift test 84, watchOS BUILD SUCCEEDED. | M |

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
| 23 | CX-012 | Not a true one-line integration (needs `postprebuild` for link/Info.plist) | ✅ **DONE** | was: consumers hand-wired a `postprebuild` script | The config plugin now links the SwiftPM host + merges the target Info.plists DURING `expo prebuild` — it registers its own custom xcode base mod (`withGeneratedBaseMods`) after @bacons/apple-targets so it runs once the targets exist, then re-opens the .pbxproj with `wireLocalPackage`. `expo prebuild` alone fully wires; no postprebuild, no wrapper. Verified by real plain-`expo prebuild -p ios --clean` on demo + example (products linked, plist merged). | L |
| 24 | CX-020 | Expo example doesn't dogfood the package's plugin | ✅ **DONE** | was: app.json listed only `@bacons/apple-targets`; README told you to copy the Swift host from the reference app | The expo example now uses the `react-native-watchos` plugin (not raw apple-targets), its watch `@main` glue is `react-native-watchos scaffold`-generated, and prebuild is plain `expo prebuild` (the plugin links + merges in-prebuild). README rewritten to that flow; generated target files gitignored (matching the demo). Verified by a real `expo prebuild -p ios --clean`: ReactWatchHost linked, Info.plist merged. (minimal-app README `file:`→`workspace:*` = DX-1, separate.) | M |

## Phase 5 — Maintainability & API surface

| # | ID | Problem | Verdict | Evidence | Fix (decided where noted) | Eff |
|---|----|---------|---------|----------|-----|-----|
| 25 | CX-021 | Global `fetch` not WHATWG (re-readable body, URL-string only, no clone/credentials/redirect; non-http accepted) — yet header claims "WHATWG-aligned" | ✅ REAL | [fetch.ts:205](../js/src/fetch.ts) re-readable; :235 string-only; no `clone`; FetchPlan no scheme allowlist | **Tighten toward WHATWG:** Request input, body-used state, `clone`, credentials/cache/redirect, allowlist `http(s)` | L |
| 26 | CX-022 | Native ops fail silently (BLE/sensor/perm/connectivity/storage) | ✅ **DONE** | was: notif permission dropped `{ _, _ in }`; BLE/connectivity fire-and-forget | Typed native result/error channel — **all shipped** over the SD-1 invoke channel: notification permission, connectivity send, scheduleNotification, saveUpdate (CX-005), and finally `bleConnect`/`bleWrite`/`bleSubscribe` with `BleSession` correlation (see the build-log entry). Remaining: ③ device-verify of the BLE ops against a real peripheral | L |
| 27 | CX-023 | Host bridge hand-duplicated though a `hostMethods` manifest exists | ✅ **DONE** | was: install hand-written in JSRuntime.swift, TS `QuickJSHostGlobal` hand-written (and drifted — it still listed `scheduleNotification`, a via-invoke method) | **The whole synchronous bridge is now generated from the schema's method signatures.** Each direct method declares `args`/`returns`; codegen emits (a) the TS `QuickJSHostGlobal`, (b) the Swift `HostBridge` callback struct, (c) the C trampolines (arg marshaling by type + return marshaling), and (d) the install table — `Generated/HostBridge.swift`. JSRuntime holds one `var bridge = HostBridge()` (the host sets feature closures, JSRuntime sets the infra setTimer/clearTimer/log defaults); the hand-written trampolines + `on*` props + `fromC` layer are deleted. **Per-method guarantee:** `HostBridgeTests.swift` drives all 17 trampolines through a real JSRuntime (real quickjs + the generated C) — args-in for every method, value-out for getItem/counterGet/counterAdd — so a marshaling bug can't pass "it compiles". The drift fixed itself (generating dropped the stale `scheduleNotification`). Verify: swift test 105 (+10), JS 246, codegen no drift, swift-format clean, watchOS host + widget builds SUCCEEDED. | L |
| 28 | CX-026 | `ShoppingIntent.swift` duplicated across watch & widget targets | 🩹 **guarded** | `diff` of the two files → **identical** | Drift risk closed by `target-source-drift.test` (fails if the two copies differ — both targets must compile the AppIntent). Full single-source dedup (shared pbxproj target membership) needs a prebuild to verify, so it's deferred to that pass; the guard keeps it correct meanwhile. | S |
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
