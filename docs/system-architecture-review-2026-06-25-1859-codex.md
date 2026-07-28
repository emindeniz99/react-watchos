# System and architecture review — Codex

**Project:** `react-native-watchos`

**Reviewed:** 2026-06-25 18:59 +03

**Baseline:** `d3d3f24`

**Scope:** runtime/process topology, trust boundaries, release/OTA design,
capability compatibility, shared state, app/widget consistency, lifecycle,
navigation, bridge protocols, observability, package boundaries, and migration
planning.

This is a second-pass architecture review. It does not repeat the defect list in
[the merged code review](./code-review-2026-06-25-1817-merged.md). It evaluates
the proposed system-design decisions, corrects weak assumptions, and describes
the target architecture I recommend before the public API or OTA format ships.

## Executive decision

Keep the core model:

- React authors a declarative tree.
- QuickJS runs on-device.
- Swift interprets the tree into native SwiftUI.
- JSON remains the process boundary.
- Full-tree commits remain acceptable until measurements prove otherwise.

Do **not** build the release system around one JS artifact, one monotonic
`hostApiVersion`, global host registration, and unversioned shared key/value
state. Those choices combine unrelated compatibility dimensions and make the
app and widget extension appear more alike than they are.

The target should instead have:

1. a signed **multi-artifact release manifest** (`app` and `widget`);
2. a structural protocol version plus a **feature/policy manifest**, not one
   host capability integer;
3. a generated, target-specific host surface;
4. an explicit runtime session and lifecycle;
5. a transactional, versioned shared-state service;
6. staged OTA activation with health checks and rollback;
7. lazy/active-stack navigation instead of eagerly mounting every route.

These are pre-release breaking changes. Implementing them now is cheaper than
adding compatibility layers around the current shape.

## Current system map

There are four operational boundaries:

1. **Watch app process**
   - QuickJS + React + `react-reconciler`
   - SwiftUI app interpreter
   - native bridges for network, BLE, sensors, notifications, connectivity,
     storage, widgets, OTA, and generation
2. **Widget extension process**
   - a separate 16 MiB-capped QuickJS runtime
   - WidgetKit providers and a second SwiftUI interpreter
   - intent handlers that can mutate App Group storage
3. **Shared App Group**
   - widget payload JSON
   - arbitrary `Storage` values
   - OTA source, bytecode, metadata, and high-water state
4. **External systems**
   - OTA server/signing authority
   - paired iPhone over WatchConnectivity
   - network/BLE/sensor/notification services

The important architectural fact is that the watch app and widget extension are
different processes, with different budgets, lifecycles, permissions, and host
surfaces. They should share contracts and state, but they should not be forced
to load the same executable artifact or receive the same capabilities.

## Proposal verdicts

| Existing proposal | Verdict | Required correction |
|---|---|---|
| SD-1 typed command/result channel | **Keep, refine** | Add cancellation, timeout, target policy, and generated typed envelopes. Move storage mutation into it. |
| SD-2 one shared interpreter | **Keep the shared contract; refine implementation** | Share parsing and exhaustive dispatch, but use context-specific adapters rather than one `interactive: Bool` switch for every platform difference. |
| SD-3 `hostApiVersion` / `minHostApi` | **Replace** | A scalar version cannot model optional, entitled, OS-, hardware-, policy-, and permission-dependent features. |
| SD-3 esbuild-metafile derivation | **Reject as authority** | The preset does not currently emit a metafile, and import presence is not a reliable executable capability contract. Use an explicit generated manifest; static analysis is validation only. |
| SD-4 OTA state machine | **Keep, expand** | Make releases multi-artifact, verify hashes at boot, add read-only validation, boot health, crash-loop rollback, and signing-key rotation. |
| SD-5 enforce JS thread | **Keep** | Make one runtime executor/session own every QuickJS call and teardown path. |
| SD-6 schema as source of truth | **Keep** | Generate target-specific bridge surfaces and protocol metadata; do not generate one universal host installed everywhere. |

## Findings and decisions

### [ ] ARCH-01 — Replace scalar host API compatibility with feature manifests

**Priority:** P0, before OTA compatibility work.

The proposed `hostApiVersion` assumes that a binary at version `N` supports all
capabilities up to `N`. The actual system does not have that property:

- app and widget targets support different methods;
- some methods require entitlements or configuration;
- some depend on OS version or hardware;
- permission state changes at runtime;
- consumers may intentionally disallow capabilities.

The current runtime installs every method unconditionally
([JSRuntime.swift](../js/swift/Sources/ReactWatchRuntime/JSRuntime.swift#L359)),
while the schema already declares target subsets
([schema.mjs](../js/codegen/schema.mjs#L148)). The codegen test then enforces
the universal installation, contradicting the target metadata
([codegen.test.ts](../js/test/codegen.test.ts#L21)).

**Decision**

Use two layers:

- structural versions: `wireVersion`, `bridgeProtocolVersion`, `engineABI`;
- feature descriptors: stable feature IDs with versions and status.

Example native descriptor:

```json
{
  "bridgeProtocol": 2,
  "engineABI": "quickjs-ng:<build-hash>",
  "target": "watch",
  "features": {
    "storage.read": {"version": 1, "status": "available"},
    "network.fetch": {"version": 1, "status": "available"},
    "health.heartRate": {"version": 1, "status": "permissionRequired"},
    "ai.generate": {"version": 1, "status": "unavailable"}
  },
  "allowedFeatures": ["storage.read", "storage.write", "network.fetch"]
}
```

The signed bundle manifest declares `requiredFeatures` and `optionalFeatures`.
Activation requires every required feature to be supported and policy-allowed.
Permission-dependent features remain runtime results, not boot blockers unless
the application explicitly marks them mandatory.

**Acceptance**

- [ ] Define stable feature IDs and per-feature versions in the schema.
- [ ] Distinguish compiled support, policy allowance, runtime availability, and
      user permission.
- [ ] Generate separate app and widget host installation tables.
- [ ] Do not use `typeof __host.method` as the capability source of truth.
- [ ] Add activation tests for target, entitlement/configuration, OS, optional
      feature, and permission cases.

### [x] ARCH-02 — Replace import-derived `minHostApi` with an explicit release contract

> *(2026-07-05: shipped — declared `requiredFeatures` in build config, validated `⊆ provided` and stamped into the manifest (the sound half; `declared ⊇ used` deliberately unchecked — ARCH-02 note in the merged backlog). Verification: the merged backlog's build-progress
> log entry; item-level acceptance is tracked there.)*

**Priority:** P0.

The current design note says the esbuild metafile is already produced, but
[preset.mjs](../js/esbuild/preset.mjs#L45) does not enable `metafile`. More
importantly, named imports are not a sufficient compatibility authority:

- re-exports and namespace imports obscure usage;
- wrappers can invoke capabilities indirectly;
- importing an optional feature does not mean every execution requires it;
- dynamic/direct bridge calls can evade the mapping;
- tree-shaking and build configuration change what the metafile reports.

**Decision**

The application build must produce an explicit, generated capability contract
per artifact. It can be declared through app configuration and augmented by
generated wrappers/component metadata. Static analysis should fail the build
when it observes an undeclared capability, but it should not silently decide the
security or compatibility policy.

**Acceptance**

- [ ] Add `watchReleaseConfig` with required/optional features per entrypoint.
- [ ] Make generated wrappers and primitives emit stable feature markers.
- [ ] Use build analysis as a consistency check against the explicit manifest.
- [ ] Reject direct access to raw `__host` from public application code.
- [ ] Sign the final declared feature sets with the release.

### [x] ARCH-03 — Build separate app and widget artifacts

> *(2026-07-05: shipped — split `app.entry` / `widget.entry`, two emitted bundles, widget bundle carries no `runApp`. Verification: the merged backlog's build-progress
> log entry; item-level acceptance is tracked there.)*

**Priority:** P0.

The build creates one `dist/bundle.js` and copies it unchanged to both targets
([config.mjs](../js/scripts/config.mjs#L17)). The widget then evaluates the
whole application artifact inside a 16 MiB QuickJS limit
([IntentRuntime.swift](../app/targets/widget/IntentRuntime.swift#L18)).

This couples the widget to app-only routes, libraries, initializers, and host
features. It also makes the capability gate ambiguous: one artifact is expected
to run against two different host surfaces.

**Decision**

Produce at least two self-contained IIFEs:

- `app.bundle.js`: UI, app lifecycle, app capabilities;
- `widget.bundle.js`: widget registration, timeline rendering, and intents only.

They are signed and activated as one release, but have independent hashes,
sizes, feature requirements, engine constraints, and memory budgets.

**Acceptance**

- [ ] Add explicit app and widget entrypoints.
- [ ] Prevent widget builds from importing app-only modules/capabilities.
- [ ] Enforce independent bundle-size and peak-memory budgets.
- [ ] Activate both artifacts atomically under one release ID.
- [ ] If the widget artifact is absent or incompatible, keep displaying the
      last app-published static timelines and disable JS mutation.

### [x] ARCH-04 — Make OTA activation transactional and health-aware

> *(2026-07-05→27: CLOSED — six slices + `keyId` rotation shipped: bytecode
> hash-binding, read-only validation, crash-loop rollback, atomic `OTARecord`
> apply, previous-known-good restore, and the explicit `bundleReady` health
> signal (`OTAConfig.healthSignal: .explicit` + `markUpdateHealthy()`). See the
> merged backlog build log. Accepted limit, owner-signed: under the DEFAULT
> `.firstCommit` policy the first committed tree clears the boot counter, so a
> bundle that renders and then reliably dies never reaches the rollback
> threshold. The "bounded stabilization interval" in the Decision below is
> deliberately NOT shipped as an unconditional default — watchOS sessions are
> glance-length, so a bare timer would roll back healthy bundles for anyone who
> checks the time and drops their wrist. `.explicit` closes the gap for apps
> that care; if a middle ground is ever wanted it slots in as a third
> `OTAHealthSignal` case ("first commit AND (T elapsed OR the scene backgrounded
> cleanly)"), not as a bare timer.)*

**Priority:** P0.

The current OTA path validates syntax/bytecode loading and advances the
high-water mark immediately after evaluation
([ReactWatchHost.swift](../js/swift/Sources/ReactWatchHost/ReactWatchHost.swift#L317)).
Module evaluation can execute arbitrary application initializers, mutate
storage, publish widgets, or start work before the app proves it can render and
remain healthy. A later launch crash has no crash-loop rollback protocol.

**Decision**

Use release states:

`downloaded -> verified -> staged -> validated -> active -> healthy`

Validation runs each artifact with a restricted, read-only host. Activation
updates one atomic pointer to a release directory. The app marks the release
healthy only after a successful render and a bounded stabilization interval.
Repeated failed boots roll back to the previous known-good release.

The release record should include:

```text
schemaVersion, releaseId, keyId, createdAt
artifacts[app|widget]: hash, size, engineABI, wireVersion,
                      bridgeProtocol, requiredFeatures, optionalFeatures
dataSchemaRange, signature
```

**Acceptance**

- [x] Verify signature before staging and source hash on every boot.
      (`OTABootSequencer.stage` verifies before `persist`; `verifyStored` re-verifies
      at every boot under enforced keys — NF-35.)
- [x] Key bytecode by source hash and engine ABI. (OP-1: the record pins
      `bytecodeHash`; a stale blob falls back to the source.)
- [x] Validate with a non-mutating host and explicit `bundleReady`.
      (Read-only validation eval at staging; `bundleReady` ships as
      `OTAConfig.healthSignal: .explicit` + `markUpdateHealthy()`.)
- [x] Keep current and previous known-good release directories. (`active` /
      `knownGood` slot stores, promoted on the health signal.)
- [x] Track boot attempts/lease and roll back after a defined threshold.
      (`otaBootAttempts`, `maxOTABootAttempts: 3`, `VersionPolicy.crashLoopRecovery`.)
- [x] Add signing `keyId`, trusted-key set, and a documented rotation path.
      (CX-007; rotation in [ota-signing.md](./ota-signing.md).)
- [x] Fault-inject every staging/activation boundary. (`OTABootSequencerTests`:
      record-write failure, eval throw, bad signature, lapsed expiry, crash-loop,
      rollback-also-fails, unconfirmed-under-`.explicit`.)

### [x] ARCH-05 — Treat persisted UserDefaults JSON as a data schema now

> *(2026-07-05: shipped — atomic cross-process counter (`CoordinatedCounterStore` + `Storage.counterAdd`) fixing the app↔widget lost-update. Verification: the merged backlog's build-progress
> log entry; item-level acceptance is tracked there.)*

**Priority:** P0 if OTA remains enabled; otherwise P1.

The assertion “there is no DB, therefore there is no data migration problem” is
incorrect. `Storage` persists arbitrary JSON
([storage.ts](../js/src/storage.ts#L12)), and the demo/reference application
stores structured shopping lists and initializes them at module load
([shoppingStore.ts](../js/demo/shoppingStore.ts#L39)). The app and widget intent
process can both write this shared state.

A database engine is not required for schema incompatibility, lost updates, or
partial migration.

**Decision**

Introduce a native `StateStore` abstraction in the App Group. UserDefaults may
remain for small settings, but application documents need:

- `schemaVersion`;
- monotonically increasing `revision`;
- atomic compare-and-swap/transaction operations;
- migration support;
- explicit ownership and conflict behavior.

For a small watch data set, a SQLite-backed actor or atomic file/document store
is preferable to whole-object UserDefaults writes. JS should access mutation
through typed commands, not unrestricted `getItem`/`setItem`.

**Acceptance**

- [ ] Add `dataSchemaRange` to the release contract now.
- [ ] Define a transactional migration protocol before production OTA.
- [ ] Store structured documents as `{schemaVersion, revision, data}`.
- [ ] Make app and widget intent writes use the same transactional service.
- [ ] Add concurrent-writer and interrupted-migration tests.
- [ ] Until this exists, document OTA as safe only for data-compatible releases.

### [x] ARCH-06 — Bind widget publications to state and release revisions

> *(2026-07-27: shipped — `PublishedWidgets` carries `stateRevision` +
> `releaseId`, a monotonic per-App-Group revision minted natively inside the
> Storage bridge closures (`StateRevisionTracker` batching over a
> `CoordinatedCounterStore` in its own `revision/` subdirectory),
> `WidgetSnapshot.freshness` as the consumer-side gate, and reconciliation on
> the app's first commit + every foreground. Evidence: the merged backlog's
> build-progress log entry.)*
>
> **What is actually guaranteed** (owner-signed, deliberately not
> "linearizable"):
> 1. The revision is **monotonic and cross-process atomic** — one
>    `NSFileCoordinator` write claim per bump, the ARCH-05 guarantee. (Darwin
>    only; Linux is an unclaimed RMW for unit tests.)
> 2. The bump happens **before** the state write, so every crash between
>    mutation and publication reads as **stale, never as current**. Within a
>    process the detection is exact. Fail-stale is the only acceptable
>    direction: the reverse ordering is the bug this item exists to close.
> 3. **Residual cross-process window**: process A can sample the revision at
>    render start after process B bumped but before B's UserDefaults write
>    lands (sub-millisecond), and stamp "current" over data it read pre-write.
>    B's own publication immediately supersedes it — with `invalidateCache` +
>    `reloadAllTimelines` forcing a re-read — so the system converges. That is
>    "eventually consistent, inconsistency observable and recoverable", exactly
>    the Decision's wording, not linearizability.
> 4. Closing (3) needs a 2-phase `pending`/`committed` revision pair — two
>    coordinated claims per batch. **Recorded as a follow-up, not built.**
>
> The state write (a UserDefaults key) and the revision bump (a coordinated
> file) remain two stores: watchOS App Groups offer per-key UserDefaults
> atomicity and per-file coordination claims, and no cross-key transaction.
> Making them one operation means moving the whole Storage KV into a
> coordinated document — the transactional store deferred at ARCH-05 above.
> Sampling discipline that (2) depends on: the revision stamped on a payload is
> sampled at **render start**, before any `render()` callback reads state.

**Priority:** P1.

State mutation and widget publication are separate operations. An intent writes
state and then publishes timelines; the app also writes state and republishes.
A crash between those steps leaves valid state with stale derived timelines.
Timestamp comparison alone cannot prove consistency.

**Decision**

Every committed state mutation returns a revision. Widget payloads include:

- source state revision;
- producing release ID;
- payload schema version;
- generated-at time.

Publication is idempotent. Providers can reject payloads from an incompatible
release, detect stale revisions, and request/recompute a refresh. The system
remains eventually consistent, but inconsistency is observable and recoverable.

**Acceptance**

- [x] Add revision metadata to `PublishedWidgets`. (`stateRevision: Int` +
      `releaseId: String?` in `codegen/schema.ts`; the payload schema version
      `v` and the generated-at `publishedAt` were already there.)
- [x] Persist state revision and payload atomically where practical. (The
      stamps ride INSIDE the one JSON string under the one UserDefaults key, so
      payload↔stamp can never tear. State-write↔bump is the residual window
      above — "where practical" is doing real work in that sentence.)
- [x] Add reconciliation on app launch and after intent completion.
      (`reconcileWidgets()` on the first healthy commit and on every
      foreground; intent completion already republishes on any Storage write —
      `intents.ts` — and that publication now closes the revision batch.)
- [x] Test crash between mutation and publication. (`PayloadFreshnessTests`
      pins bump-without-publication → `.staleRevision` even inside a live
      `reloadAfter`; the JS suite simulates the lost publication with a
      throwing host and asserts the surviving mismatch.)

### [x] ARCH-07 — Enforce host policy, not only host availability

> *(2026-07-17: shipped — `HostPolicy` in ReactWatchSupport, per-feature generated
> install guards, typed `POLICY_DENIED` invoke rejections, the policy check at OTA
> staging + in the validator runtime, and the widget's fast typed invoke rejection.
> Evidence: the merged backlog's build-progress log entry.)*

**Priority:** P0 for signed OTA.

A validly signed OTA bundle is arbitrary code with every native privilege the
host installs. Current plugin configuration and schema targets do not enforce a
runtime allowlist. Signature verification proves publisher identity; it does
not prove least privilege.

**Decision**

Create `HostPolicy` per consumer and target. The runtime installs only allowed
features, and activation verifies the bundle requirements are a subset of that
policy. Sensitive additions such as health, BLE, network, notifications, and AI
must require an explicit consumer configuration change/native release.

**Acceptance**

- [x] Generate target-specific installation from `HostPolicy`.
- [x] Keep compatibility and authorization as separate decisions.
- [x] Add policy-denied typed errors.
- [x] Test that widget and OTA runtimes cannot call undeclared app capabilities.

### [x] ARCH-08 — Pair `runApp`'s globals with a `WatchRoot.dispose()`; make Swift runtime teardown queue-confined

> *(2026-07-27: shipped, RE-SCOPED — the heading above is the delivered scope;
> the original was "Introduce a runtime session with deterministic teardown".
> The `RuntimeSession` object graph was NOT built and was not the remaining
> work: a reload already destroys the whole QuickJS context (`boot()` →
> `runtime = nil` → `makeRuntime()`), so every process global and module
> binding resets by construction, and every async settle is already
> generation-guarded (CX-008). What was genuinely unsolved was (a) a
> same-context second `runApp` silently double-mounting, (b) the inspector's
> diagnostics latch desyncing from the listener table, and (c) QuickJS being
> freed off its owning queue. Those three shipped. Evidence: the merged
> backlog's build-progress log entry.)*
>
> *(2026-07-27, amendment: claim (a) as written overstated the fix.
> `runApp`'s single-root guard covers a second `runApp` within ONE
> evaluation. It cannot see across evaluations — the bundle is an IIFE, so
> `js.evaluate(bundle)` a second time into the same context gets a fresh
> module scope (and a fresh `activeRoot`) while the globals persist, which
> is exactly what the OTA→shipped fallback does after a bad bundle throws.
> That case is covered by the `__disposeActiveRoot` global, which the host
> calls before every bundle eval to tear the previous root down. Module-scope
> side effects of the half-executed bundle still survive into the fallback;
> the complete answer is a fresh `JSRuntime` for the fallback boot.)*
>
> *(2026-07-28: **the complete answer shipped.** `load()` latches whether an OTA
> artifact evaluated into the boot's runtime, and if one did and failed,
> `replaceRuntimeAfterPoisonedOTA()` tears that generation down
> (`tearDownGeneration()` — fetches, sensors, BLE correlation, media/session,
> `JSRuntime.shutdown()`, generation bump) and builds+wires a new runtime via
> `installFreshRuntime()` for the shipped eval. `__disposeActiveRoot` stays, now
> covering only the bytecode→source retries, which re-evaluate the SAME bundle.
> Details, incl. the four traps (parked `markUpdateHealthy`, boot-attempt
> accounting, `commitBlesses` recompute, the second generation bump) are on the
> merged backlog's ARCH-08 build-log entry.)*

**Priority:** P1.

`runApp` writes process-global callbacks
([index.ts](../js/src/index.ts#L182)); listeners, intents, widget registries, and
fallback storage are module-global. The Swift model owns a runtime plus native
services, but there is no one lifecycle object that cancels fetches, sensors,
BLE, timers, subscriptions, globals, and pending command promises together.

**Decision**

Replace the implicit singleton API with:

```text
RuntimeSession
  - host descriptor and policy
  - QuickJS executor
  - React root
  - command registry
  - native-event registry
  - intent/widget registry
  - cancellation scope
  - diagnostics
  - dispose()
```

The device app may still enforce one active session, while tests can construct
isolated sessions without deleting globals manually.

**Acceptance**

- [ ] ~~`createWatchApplication(config)` returns a disposable session.~~
      **REJECTED and restated:** `runApp(element, host)` already returns a
      `WatchRoot`, so a new factory + config type earns nothing — the config
      surface it implies (host descriptor, policy) is Swift-owned already
      (`HostPolicy`, ARCH-07), and a second way to mount would be the
      speculative abstraction rule 2 forbids. Restated as: **`runApp` returns a
      root with `dispose()`**, which shipped (`renderer.ts`), plus a
      single-active-root guard so a second `runApp` throws instead of
      superseding silently.
- [x] All global entrypoints delegate to the active session. (Restated: the
      three `runApp` globals — `__dispatchEvent`, `__pushNativeEvent`,
      `__inspect` — are installed and uninstalled as a PAIR, identity-checked,
      so a superseded root can never uninstall its successor's. `__handleIntent`
      and `__renderWidgets` stay deliberately session-less: the widget/intent
      process never calls `runApp`, so routing them through a root would break
      those entrypoints.)
- [x] Reload disposes the old session before starting the new one. (Already
      true via `boot()`'s generation bump + reset block; now provably ordered —
      `runtime?.shutdown()` immediately before `runtime = nil`, so QuickJS is
      freed after `sensors.stopAll()` / `bluetooth.resetPendingForReload()` /
      the media stops rather than whenever ARC got around to it. JS `dispose()`
      is deliberately NOT called on this path: the context is being destroyed
      wholesale.)
- [x] Teardown cancels timers, fetches, sensors, BLE work, and pending promises.
      (`boot()` already cancelled the native half; `JSRuntime.shutdown()` now
      cancels the QuickJS timer sources ON the owning queue. In-flight
      invoke/fetch/generate promises are deliberately left to their watchdogs
      rather than rejected by `dispose()` — they are id-correlated to native
      work that is still running, and rejecting would fire while the same
      native op is live. Upgrading the BLE reload path from *drop* to *reject
      loudly* was evaluated and deferred — see the backlog note.)
- [x] Tests can create sequential sessions without leaked listeners/registries.
      (`test/helpers.ts` gains `mountApp()` + `resetApp()`; all eight bespoke
      `afterEach` teardown blocks are gone and every `runApp` call site in the
      suite is disposed.)

### [x] ARCH-09 — Make navigation JS-confirmed and serialize only active stack screens

> *(2026-07-16: shipped — nav transaction: structured `DispatchResult`, Swift confirm-then-animate, lazy `StackWinners` mounting; measured 152→48 nodes / 1.32→0.52 ms per dispatch. Verification: the merged backlog's build-progress
> log entry; item-level acceptance is tracked there.)*

**Priority:** P1; breaking UI/lifecycle change.

Every route mounts and serializes at launch
([navigation.tsx](../js/src/navigation.tsx#L245)) because Swift optimistically
changes `pendingPath` before JS commits
([NodeView.swift](../js/swift/Sources/ReactWatchHost/NodeView.swift#L493)).
This causes inactive screen effects to run, increases the committed tree, and
makes navigation scalability depend on developers remembering
`useFocusEffect`.

**Decision**

Use the existing synchronous event bridge as a navigation transaction:

1. native proposes a path;
2. JS handler synchronously accepts/rejects and commits the active stack;
3. native animates the confirmed path;
4. only root plus active stack destinations are serialized.

The event result should be structured (`handled`, `accepted`, optional reason)
rather than the current Boolean result that Swift discards.

**Acceptance**

- [ ] Add request/ack semantics to navigation events.
- [ ] Roll back immediately on missing handler or thrown JS error.
- [ ] Lazy-mount route content and preserve only configured stack state.
- [ ] Measure transition latency on device.
- [ ] Add route preload only as an explicit optimization.

### [~] ARCH-10 — Refine the shared interpreter into a shared core plus adapters

> *(2026-07-27: **Phase A shipped; Phase B declined at two targets** — a
> measured decision, not an oversight. Phase A extracted the byte-identical
> SwiftUI value mappings (color/font/alignment/chart/rich-text) into the shared
> `ReactWatchUI` target (`RNUI`), so the drift this item names is now
> structural, not test-enforced. Phase B — one tree-walk behind a
> `RenderAdapter` — was measured against both interpreters and rejected for
> now: only ~38 net lines are reachable ONLY by unifying the walk (12 of the 41
> primitives have identical case bodies; the other 29 differ by design —
> interactivity, timers and navigation exist only in the app, static rendering
> and families only in the widget), and the refactor would rewrite ~380 lines
> of watchOS-only view code that `swift test` compiles to an empty module while
> deleting the `case "X":` labels that `component-contract.test.ts` and
> `interpreter-prop-parity.test.ts` parse — i.e. removing its own safety net.
> Empirically the drift pressure is 8 lines: since these files were created,
> exactly two commits changed both for parity reasons (`5c303e1` SecureField,
> `40eac2c` min/max), 4 widget lines each; the other 15 app-interpreter commits
> shared nothing.
> **Trigger to revive: a THIRD render target** (the iOS/macOS widget host,
> [roadmap §7](./roadmap.md)) — at that point forking the switch a third time
> is the cost being paid, and the design to use is the `RenderContext`
> COMPOSITION shape (`ctx.button(node, children)` polymorphism, no
> `if isInteractive`), already specified in the roadmap's "ARCH-10 Phase B"
> bullet and to be designed for all three targets at once.
> Acceptance below is re-read: box 1 is moot (no `interactive: Bool` was ever
> built — the shipped shape is two types over a shared kernel), box 2 is met by
> `components[].widget: "full" | "degraded"` + the contract test, box 3 is met
> by the module graph (`ReactWatchWidget` never depends on `ReactWatchHost`;
> MapKit/HealthKit are host-only) and is what Phase B would most likely break,
> box 4 is met at the prop-read level and its remaining half — a watchOS render
> snapshot harness — is independent of Phase B.
> Residual duplication, if anyone is already in these files with a watchOS build
> green: the layout-modifier leaves (~41 lines/side, byte-identical), the
> once-per-type unsupported-node logger (~9/side), route-path normalization
> (4/side, byte-identical), and the `gauge`/`chart`/`navigationLinkLabel`
> builders (~26/side, byte-identical) — Groups B and D from the
> [2026-07-05 hand review](./human-review-2026-07-05-interpreter-duplication.md),
> which Phase A was scoped for and did not take. Net −91 lines, no walk change.
> Opportunistic, not scheduled.)*

**Priority:** P1.

Deleting the duplicate widget interpreter is correct. A single
`interactive: Bool` context is too narrow for future differences in supported
frameworks, navigation, gestures, environment values, rendering degradation,
and extension budgets.

**Decision**

Create:

- shared generated primitive contract;
- shared parsing/style/layout helpers;
- one exhaustive primitive dispatch core;
- app and widget `RenderAdapter`s that provide supported operations and
  degradation policy.

This retains one semantic implementation without forcing every app-only
dependency or behavior into the widget module.

**Acceptance**

- [ ] Replace `interactive: Bool` with an explicit render-context protocol.
- [ ] Make unsupported/degraded behavior schema-defined and exhaustive.
- [ ] Verify the widget target does not link unnecessary app-only frameworks.
- [ ] Golden-test every primitive in both contexts.

### [x] ARCH-11 — Declare and fixture the invoke channel's shapes; close its error set at runtime

> *(2026-07-27: shipped, RE-SCOPED P1 → P2 — the heading above is the delivered
> scope; the original was "Complete the typed bridge as a protocol, not a
> generic escape hatch". Two of the five acceptance boxes were **already
> shipped** when this was picked up (disposed-session/unknown-id rejection, and
> the preserved streaming channels); three are **rejected outright** and struck
> below. The premise "without generated method IDs/types … it can become a
> second stringly typed bridge" was measured rather than assumed: every
> JS-declared shape was checked against its Swift producer/consumer and the
> structural drift found was **zero**. What the missing shape contract HAD let
> through was four adjacent defects — a bespoke `LOCATION_UNAVAILABLE` reject
> code outside the closed set (the second instance of that class in a month),
> three silently-defaulting decodes, one entirely unguarded surface (the JS
> caller literals), and a lifecycle promise that resolved before its session
> ran. Those are what shipped. Evidence: the merged backlog's build-progress
> log entry.)*
>
> *(2026-07-27, scope note: the shapes are declared and generated, but the 31
> Swift handlers keep their own hand-written decoders. So the gate proves
> "the JS payload matches the schema" and "the schema matches the public TS
> types" — it does **not** force a handler to read the field names its method
> declares. That last step is option (i) below, deliberately not taken.)*

**Priority:** ~~P1~~ → **P2** (re-scoped 2026-07-27).

The proposed `invoke(id, method, payloadJson)` is the right transport shape, but
without generated method IDs/types, cancellation, and timeout semantics it can
become a second stringly typed bridge.

**Decision**

Generate command/request envelopes from the schema:

```text
requestId, methodId, payload, deadline, sessionId
result | typed error | cancelled
```

Keep event streams separate. Fold fallible storage mutation, OTA, BLE,
notifications, connectivity, fetch, and generation into the request lifecycle
where their delivery semantics require acknowledgement.

> **The Decision text is partly stale — struck 2026-07-27.** The envelope's
> `deadline` and `sessionId` fields are rejected (see the acceptance boxes
> below). ~~"Fold fallible storage mutation, OTA, BLE, notifications,
> connectivity, fetch, and generation into the request lifecycle."~~ OTA, BLE,
> notifications and connectivity have **been** on the channel since SD-1;
> `fetch` and `generate` are *documented exclusions* (abort semantics and
> streaming, each with its own dedicated path) and moving them would be a
> regression; and storage mutation was **superseded** — the backlog's SD-4 note
> settled on `CoordinatedCounterStore` + `Storage.counterAdd` (an
> `NSFileCoordinator` write-claim), because the cross-process
> read-modify-write cannot be made correct by routing it through invoke. The
> surviving instruction, "keep event streams separate", was already satisfied
> and stays satisfied.

**Acceptance**

- [x] Generate TS and Swift request/result/error types. (Delivered as
      `invokeShapes` in `codegen/schema.ts` + `HostMethod.request`/`.response`
      refs, with an explicit `"opaque"` sentinel for the three connectivity
      payloads that are the consuming app's own JSON by contract. TS interfaces
      + an `INVOKE_SHAPES` table are emitted into `src/generated/wire.ts`;
      Codable mirrors into the **test target** (`Tests/…/Generated/
      InvokeShapes.swift`) rather than `ReactWatchCore`, since the shapes are a
      contract and not a runtime dependency — emitting them into Core would put
      ~20 types nobody instantiates into both shipping binaries, the widget
      extension included. The **error** type is the part that changed at
      runtime: `InvokeErrorCode` is now a Swift enum that
      `InvokeErrorJSON.make` takes, so a bespoke code is a compile error at the
      reject site, and JS's `settle()` validates instead of casting.)
- [ ] ~~Add timeout and cancellation on both sides.~~ **Timeout: already done,
      JS-side, deliberately** — `INVOKE_TIMEOUT_MS` 30 s with a 5 min
      user-mediated tier and a per-call override. A *native* deadline is
      **REJECTED**: it cannot preempt a `CBPeripheral` delegate callback,
      `UNUserNotificationCenter.add`, `Product.purchase()`, or `MKLocalSearch`
      anyway, so it would only add a second, weaker timer that can disagree
      with the JS one and settle the same id twice — which `settle()` would
      then silently swallow, hiding the disagreement. **Cancellation: REJECTED**
      — zero callers want it; the one op with a real abort story (`fetch`) is
      deliberately off this channel with its own `abortFetch`; the SD-1
      shipping note already justified deferring it from prior art
      (Capacitor/RN/TurboModule). A `cancelled` state would grow a
      cancellation check in all 31 handlers for a feature nothing calls.
- [x] Reject replies for disposed sessions or unknown request IDs. (Already
      true on both sides when this item was picked up: JS `settle()` does
      `pending.get(id)` → `if (!entry) return`, so an unknown or duplicate id
      is a silent no-op; every async Swift settle captures `let gen =
      generation` and drops on mismatch (CX-008). The extended-runtime fix in
      this pass is the newest instance of that same guard.)
- [ ] ~~Define backpressure/maximum in-flight requests.~~ **REJECTED.**
      Observed concurrent in-flight invokes: ~2 (a `getUpdateState` at boot
      plus one user-initiated op). A cap would be a limit chosen from nothing,
      and its rejection would need a code outside the closed set — the exact
      problem this pass spent its effort closing.
- [x] Preserve dedicated streaming channels for sensors/BLE/connectivity
      events. (Unchanged and now pinned: BLE/sensor notifications and inbound
      connectivity stay on `pushNativeEvent`; `fetch`/`generate` keep their own
      paths. The schema's `ble`/`sensor`/`fetch`/`generate` are direct methods,
      not `via:"invoke"`, and `invoke-routing.test.ts` fails if a JS caller
      ever routes one of them through the channel.)

**Rejected alternative — full generated envelopes (option (i), the review's own
shape).** Schema-declared `args`/`returns` driving generated Swift `Codable`
request structs and a generated decode switch between the ARCH-07 gate and the
dispatcher. Its marginal benefit over what shipped is compile-time rather than
test-time enforcement of payload shapes for **9 methods** — and those 9 already
have hand-written guards. Its cost is a 31-handler signature migration that
supersedes two already-unit-tested hand-written decoders (`NotificationPlan`,
`BluetoothBridge.InvokePayload`), needs a stringly escape hatch for the three
opaque connectivity payloads anyway, and drags `saveUpdate`'s decode back onto
main (it lives inside `OTASequencer.stage`, off-main, by M5). That is a large
cost against a **measured** structural drift of zero. The trade-off is recorded
on the `invokeShapes` doc block in `codegen/schema.ts` so it is revisitable:
revisit if a fixture ever actually catches a shape break, or if the invoke
surface grows well past 31 methods.

### [x] ARCH-12 — Split WatchConnectivity delivery semantics

> *(2026-07-16: shipped — `updateApplicationContext`/`transferUserInfo` + split inbound channels over one `onPush` wiring. Verification: the merged backlog's build-progress
> log entry; item-level acceptance is tracked there.)*

**Priority:** P2.

`sendToPhone` chooses `sendMessage` when reachable and
`updateApplicationContext` otherwise
([PhoneConnectivity.swift](../js/swift/Sources/ReactWatchHost/PhoneConnectivity.swift#L23)).
Those are different contracts: immediate best-effort messaging versus
latest-value state replacement. A caller cannot know which occurred, receive a
reply, or detect failure.

**Decision**

Expose separate APIs:

- `sendMessage(payload, timeout) -> reply`;
- `transferUserInfo(payload) -> queued`;
- `setApplicationContext(snapshot) -> accepted`;
- `transferFile(...)` when needed.

**Acceptance**

- [ ] Remove transport switching from one API.
- [ ] Return delivery/queue errors through the typed command channel.
- [ ] Add message IDs and idempotency guidance.

### [x] ARCH-13 — Add structured diagnostics and operating budgets

> *(2026-07-16: shipped — structured `Diagnostic` ring + `BudgetPolicy` warn-only budgets + `onDiagnostic` JS event. Verification: the merged backlog's build-progress
> log entry; item-level acceptance is tracked there.)*

**Priority:** P1.

`startupError` and one last-write-wins `runtimeError` string
([ReactWatchHost.swift](../js/swift/Sources/ReactWatchHost/ReactWatchHost.swift#L29))
cannot distinguish fatal startup failure, transient command failure, capability
denial, wire incompatibility, OTA rollback, or user-actionable permission state.

Full-tree serialization also has no enforced operating budget.

**Decision**

Use structured diagnostics:

```text
code, severity, subsystem, sessionId, releaseId, target,
timestamp, userAction, details
```

Keep a bounded ring buffer and pluggable sink. Add release/runtime metrics for
startup time, JS heap, bundle size, node count, JSON bytes, serialization,
decode, commit latency, command latency, widget render time, and rollback count.

**Acceptance**

- [ ] Define fatal/recoverable/info diagnostic policy.
- [ ] Keep user-facing UI separate from developer diagnostics.
- [ ] Enforce configurable node/JSON/commit/widget-render budgets.
- [ ] Add diagnostics to inspector snapshots.

### [x] ARCH-14 — Isolate the unsupported reconciler surface

> *(2026-07-17: shipped — `reconcilerAdapter.ts` sole importer, one documented cast, version-matrix doc + upgrade-fixture tests. Verification: the merged backlog's build-progress
> log entry; item-level acceptance is tracked there.)*

**Priority:** P2.

The renderer uses `react-reconciler@0.33` with `@types/react-reconciler@0.32`
and casts the host config through `never`
([renderer.ts](../js/src/renderer.ts#L175),
[package.json](../js/package.json#L95)). This is an architecture-level upgrade
risk because React reconciler internals are not a stable public renderer API.

**Decision**

Put all reconciler-specific code behind one internal adapter and maintain an
exact tested React/reconciler compatibility matrix. Do not let the rest of the
runtime import reconciler internals.

**Acceptance**

- [ ] Add one adapter boundary and conformance suite.
- [ ] Pin exact supported React and reconciler versions.
- [ ] Run upgrade fixtures before changing either dependency.
- [ ] Prefer local maintained typings over a broad unsafe cast.

## Recommended package boundaries

Keep one npm facade for developer ergonomics, but separate internal ownership:

```text
ReactWatchProtocol
  wire models, feature IDs, release manifest, diagnostics, event envelopes

ReactWatchRuntime
  QuickJS executor, RuntimeSession, generated host bridge, command lifecycle

ReactWatchState
  App Group transactional documents, revisions, migrations, release records

ReactWatchUI
  primitive contract, shared parsing, dispatch core, render adapters

ReactWatchAppHost
  SwiftUI root, navigation, native capabilities, update coordinator

ReactWatchWidgetHost
  WidgetKit providers, intent runtime, read-only/degraded render adapter
```

The existing `Core` / `Support` / `Runtime` / `Host` split is a good start. The
main correction is to remove persistence/release concerns from generic support
helpers and stop treating the widget as merely another caller of the app
runtime.

## Migration plan

### Phase 0 — Lock contracts before more features

- [ ] Freeze new host methods and primitives temporarily.
- [ ] Approve ARCH-01 through ARCH-05.
- [ ] Define release manifest v1, feature IDs, target policies, and state
      revision/schema contracts.

### Phase 1 — Schema and target-specific runtime

- [ ] Extend schema with structural protocol versions, feature IDs, method
      envelopes, target support, and render degradation.
- [ ] Generate app/widget host installation tables and typed wrappers.
- [ ] Introduce `RuntimeSession` and deterministic disposal.
- [ ] Add structured diagnostics.

### Phase 2 — Build and release pipeline

- [ ] Split app/widget entrypoints and artifacts.
- [ ] Generate and sign the multi-artifact release manifest.
- [ ] Implement staged validation, atomic activation, boot health, previous
      known-good, and key rotation.
- [ ] Make widget consume the same active release record.

### Phase 3 — Shared state correctness

- [ ] Introduce transactional `StateStore`, revisions, and migration hooks.
- [ ] Move widget intent mutation and app persistence to typed state commands.
- [ ] Bind widget publications to state/release revisions.

### Phase 4 — UI/runtime simplification

- [ ] Merge interpreter semantics through shared core + adapters.
- [ ] Replace eager route mounting with JS-confirmed lazy navigation.
- [ ] Add full-tree operating budgets and on-device performance gates.

### Phase 5 — Public API stabilization

- [ ] Split WatchConnectivity APIs by delivery contract.
- [ ] Publish the React/reconciler compatibility matrix.
- [ ] Document threat model, OTA guarantees, state migration rules, capability
      policy, and failure/rollback behavior.
- [ ] Only then declare the package/OTA format stable.

## Decisions to avoid

- Do not use a single integer as both feature compatibility and availability.
- Do not infer security policy solely from imports.
- Do not install no-op host functions and then test capability with `typeof`.
- Do not run candidate OTA code with a mutating production host during
  validation.
- Do not treat JSON in UserDefaults as schemaless merely because it is not SQL.
- Do not load the full app artifact in the widget extension.
- Do not add partial tree diffing before measuring full-tree budgets.
- Do not split the public npm package solely to mirror internal Swift modules.

## Verification performed

- `pnpm test`: **passed** — 31 renderer test files / 189 tests, plus both example
  projects.
- `pnpm typecheck`: **passed** — renderer and both example projects.
- `pnpm lint`: **passed** — 74 files.
- `swift test`: **passed** — 51 tests.

The Swift package test does not execute the actual watchOS app/widget UI on a
simulator or device. Navigation timing, extension memory, target linking,
WidgetKit behavior, and watchOS lifecycle still require Xcode target and
on-device validation.

## Recommended first implementation decision

Start with ARCH-01, ARCH-03, and ARCH-04 together. The release manifest,
target-specific artifacts, and capability model define the foundation that
state migration, bridge codegen, widget safety, and OTA rollback all depend on.
Implementing the current scalar `hostApiVersion` design first would create work
that should then be removed.
