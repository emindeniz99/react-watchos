# Full code review — Codex — 2026-06-25 17:35 +03

Review of the complete `react-native-watchos` project: TypeScript renderer,
QuickJS bridge, Swift runtime and host, watch UI interpreter, widgets and
intents, OTA updates, native capabilities, Expo config plugin, packaging,
examples, tests, and CI.

- **Reviewer:** Codex
- **Reviewed commit:** `main` at `fdaa058`
- **Review mode:** read-only; no project files were changed during the review
- **Purpose:** actionable backlog for a follow-up implementation agent
- **Status convention:** check an item only after its acceptance criteria pass

> Concurrent-work note: after the review completed, unrelated working-tree
> changes appeared in OTA/package files. This report describes the reviewed
> state at `fdaa058`; the implementation agent should first check whether those
> changes already address part of an item.

## Summary

The renderer and native host have a coherent architecture and unusually broad
test coverage for an early watchOS runtime. The current watch app and widget
targets compile, and the JS, Swift, QuickJS, bytecode, and example test suites
pass. The main blockers are distribution correctness, OTA consistency, and
several public claims/API contracts that do not match actual platform behavior.

Do not publish `0.1.0` until **CX-001**, **CX-002**, and **CX-003** are resolved.
Do not describe OTA as production-safe until **CX-003** through **CX-007** are
resolved.

## P0 — release blockers

- [ ] **CX-001 — npm tarball includes hundreds of megabytes of Swift build output**

  - **Area:** packaging
  - **Evidence:** `js/package.json` includes the whole `swift` directory in
    `files`. `npm pack --dry-run --json` produced a package approximately
    **293 MB packed / 678 MB unpacked**, with about 7,682 entries. It included
    `swift/.build/**` and `swift/build/**`.
  - **Impact:** impractical npm installs, wasted registry/storage bandwidth,
    accidental publication of machine-local compiler output, and a high chance
    of shipping stale artifacts.
  - **Fix:** replace the broad `swift` entry with an explicit allowlist:
    `swift/Package.swift`, `swift/README.md`, `swift/Sources/**`, and only the
    test fixtures genuinely required by consumers. Alternatively add a
    package-local `.npmignore`, but an explicit `files` allowlist is safer.
  - **Also required:** add the package/project license and a `license` field to
    `js/package.json`.
  - **Acceptance criteria:**
    - `npm pack --dry-run --json` contains no `.build`, `build`, index store,
      object file, derived-data, or module-cache path.
    - Packed size is bounded in CI; recommended limit: under 10 MB compressed.
    - A clean tarball installs and its Swift package resolves and builds.
    - The tarball includes the project license and QuickJS's bundled license.

- [ ] **CX-002 — advertised on-watch Foundation Models API is unreachable**

  - **Area:** native capability/API accuracy
  - **Evidence:** `ReactWatchHost.generate` is guarded by
    `#if canImport(FoundationModels)`. Xcode 26.3's watchOS and watch simulator
    SDKs do not contain `FoundationModels.framework`, so the implementation
    always rejects with `on-device AI unavailable`.
  - **Additional defect:** `GenerateOptions.maxTokens` is public JS API but is
    absent from `GenerateRequest` and ignored natively.
  - **Impact:** a documented "shipped" feature cannot work on the target
    platform. Apps can compile against a misleading API and fail only at
    runtime.
  - **Decision required:** choose one:
    1. Remove `generateText` and all watchOS Foundation Models claims until
       Apple exposes a supported watchOS API.
    2. Redesign it as a provider interface, with phone relay and/or HTTP
       providers explicitly configured by the consumer.
  - **Acceptance criteria:**
    - No documentation claims direct on-watch Foundation Models support unless
      verified against a shipping watchOS SDK and device.
    - Every public option is implemented or removed.
    - Capability availability is queryable before sending a request.
    - Tests cover the selected provider and unavailable behavior.

- [ ] **CX-003 — malformed configured OTA key silently enables fail-open mode**

  - **Area:** OTA security
  - **Evidence:** `publicKeyBase64` is decoded with chained optional operations.
    Missing configuration and malformed configuration both become
    `updatePublicKey == nil`, which selects unsigned fail-open behavior.
  - **Impact:** a typo, truncated secret, or wrong key length silently disables
    the security control that the consumer intended to enable.
  - **Fix:** distinguish three states: not configured, configured-and-valid,
    and configured-but-invalid. Invalid configuration must fail startup or
    disable OTA with a blocking error. For production, prefer signed/fail-closed
    OTA as the default and make insecure development mode explicit.
  - **Acceptance criteria:**
    - Invalid base64, wrong length, and invalid Ed25519 representations are
      rejected loudly.
    - No invalid configured key can enter the unsigned path.
    - Tests cover absent, valid, malformed, and wrong-length keys.

## P1 — correctness and production safety

- [ ] **CX-004 — watch app and widget extension execute different JS after OTA**

  - **Area:** OTA/widgets
  - **Evidence:** the watch host loads App Group `ota-bundle.js` or its bytecode
    cache. `IntentRuntime` always loads the widget extension's bundled
    `bundle.qbc`/`bundle.js`.
  - **Impact:** after OTA, the app can run new code while widget intents and
    timeline refreshes run old code. The old widget code can overwrite newer
    timeline payloads or mutate storage using an older schema.
  - **Fix:** create a shared, versioned, verified bundle loader used by both
    processes. The extension must enforce the same signature and high-water
    policy. If the extension cannot safely load OTA code, disable fresh
    QuickJS rendering and intent mutation whenever an OTA version is active,
    using app-published static timelines only.
  - **Acceptance criteria:**
    - App and extension report the same active bundle identity/version.
    - A stale extension cannot write to storage after a newer app bundle ran.
    - Tests cover shipped, valid OTA, invalid OTA, downgrade, and missing-cache
      scenarios for both processes.

- [ ] **CX-005 — JS OTA API reports staging success before native acceptance**

  - **Area:** OTA API contract
  - **Evidence:** `applyUpdate` returns `void`; `fetchAndApplyUpdate` returns the
    manifest version immediately after invoking `saveUpdate`. Native may reject
    due to signature, rollback, size, missing App Group, invalid key, or write
    failure.
  - **Impact:** UI can tell the user an update was installed when nothing was
    persisted.
  - **Fix:** make `saveUpdate` request/response based, like fetch/generate.
    Return a structured result containing accepted version, active version,
    restart requirement, and typed rejection reason.
  - **Acceptance criteria:**
    - `applyUpdate` returns a `Promise<UpdateResult>`.
    - Persistence and metadata write failures are observable.
    - `fetchAndApplyUpdate` returns success only after native acknowledgement.
    - Tests cover every native rejection class.

- [ ] **CX-006 — OTA bundle/meta/bytecode persistence is not transactional**

  - **Area:** OTA robustness
  - **Evidence:** source, metadata, and bytecode are written independently, and
    most write errors are ignored. `persistOTA` has no success result.
  - **Impact:** power loss or storage errors can leave mismatched source,
    metadata, and bytecode. A partially written update may be treated as valid.
  - **Fix:** stage all files under a versioned temporary directory, fsync/write
    them, validate by loading in a throwaway runtime, then atomically switch one
    active pointer/manifest. Preserve the previous known-good version for
    rollback.
  - **Acceptance criteria:**
    - Active update changes atomically.
    - Failed writes preserve the prior working version.
    - Bytecode is keyed to source hash and QuickJS version.
    - Fault-injection tests cover every write boundary.

- [ ] **CX-007 — OTA freshness compares against compile-time shipped version**

  - **Area:** OTA version semantics
  - **Evidence:** `checkForUpdate` and `fetchAndApplyUpdate` compare the remote
    manifest only to `BUNDLE_VERSION`, not the currently installed OTA version
    or native high-water mark.
  - **Impact:** an already updated device can repeatedly download and stage the
    same version. JS and native can disagree about whether an update is newer.
  - **Fix:** expose native update state (`shipped`, `active`, `highWater`) and
    compare against the active accepted version. Separate compatibility/schema
    version from release/build identity so multiple compatible releases can be
    ordered.
  - **Acceptance criteria:**
    - Same-version releases have a deterministic release identifier.
    - Already-active updates are not repeatedly downloaded.
    - JS and native use one version comparison policy.

- [ ] **CX-008 — runtime replacement does not cancel or invalidate old async work**

  - **Area:** runtime lifecycle/dev reload
  - **Evidence:** `boot()` drops the old `JSRuntime`, resets JS request IDs, and
    creates a new runtime without cancelling `fetchTasks`, generation tasks,
    sensors, BLE work, timers outside the runtime, or queued decode callbacks.
  - **Impact:** an old fetch can resolve a new promise with the same numeric ID;
    stale decoded trees can overwrite the new root; native resources continue
    running after reload.
  - **Fix:** assign every runtime a generation token. Capture it in all async
    callbacks and ignore stale generations. Before replacement, cancel fetches,
    generation tasks, sensor/workout streams, pending native work, and decode
    jobs where possible.
  - **Acceptance criteria:**
    - Old-generation callbacks cannot mutate the new runtime/model.
    - Reload cancels all outstanding native operations.
    - Tests simulate ID reuse and delayed old commits/responses.

- [ ] **CX-009 — wire-version mismatch is warned but still rendered**

  - **Area:** bridge compatibility
  - **Evidence:** the host reports a mismatch and then assigns
    `self.root = tree.root`.
  - **Impact:** the project declares wire-version changes breaking, but still
    lets an incompatible tree reach the interpreter.
  - **Fix:** reject the commit before mutating root/ack state. For OTA, drop or
    quarantine the incompatible update and boot the shipped compatible bundle.
    For a shipped mismatch, show a blocking startup error.
  - **Acceptance criteria:**
    - Mismatched trees never reach `NodeView`.
    - Optimistic acknowledgements are not advanced by mismatched commits.
    - Recovery behavior is tested.

- [ ] **CX-010 — handlerless or throwing events can strand optimistic controls**

  - **Area:** renderer/native event protocol
  - **Evidence:** `WatchRoot.dispatchEvent` advances `lastSeq`, then returns
    early when no handler exists. If a handler throws, the acknowledgement path
    after `flush()` is not guaranteed. Native input views still create mutable
    bindings even when `onChange` is absent.
  - **Impact:** Toggle, Slider, Stepper, Picker, DatePicker, TextField, or Crown
    controls can display a local value forever without React accepting it.
  - **Fix:** make controlled native controls disabled/read-only without their
    handler flag. Guarantee an acknowledgement or explicit negative
    acknowledgement in a `finally` path. Consider including `handled` and
    `error` in the response rather than relying only on committed sequence.
  - **Acceptance criteria:**
    - Handlerless controls cannot enter optimistic state.
    - No-op and throwing handlers both release/rollback optimistic state.
    - JS and Swift tests cover all control types.

- [ ] **CX-011 — generated plugin state is not convergent when options are disabled**

  - **Area:** Expo config plugin
  - **Evidence:** when `widget: false`, the plugin stops writing the widget
    config but does not remove a previously generated
    `targets/widget/expo-target.config.js`. Apple-targets can continue
    discovering the stale target. Similar stale EAS extension entries can
    survive name/option changes.
  - **Impact:** repeated prebuilds do not necessarily reflect current config.
    Disabled or renamed targets can remain in builds and signing configuration.
  - **Fix:** track files and EAS entries owned by this plugin and reconcile
    additions, updates, renames, and removals. Delete only files carrying the
    plugin's generated marker; preserve consumer-authored Swift files.
  - **Acceptance criteria:**
    - `true → false → true` widget transitions produce exactly the expected
      targets each time.
    - Target renames remove old generated configs and EAS entries.
    - Idempotency tests cover option transitions, not only repeated identical
      input.

- [ ] **CX-012 — package plugin is not a complete one-line integration**

  - **Area:** developer experience/build integration
  - **Evidence:** native product linking and Info.plist merging still require
    consumer `postprebuild` scripts. The package plugin does not build the
    consumer's watch entry or generate application-specific Swift glue.
  - **Impact:** the advertised install flow is incomplete and easy to miswire.
  - **Fix/refactor:** either own target generation and linking in one ordered
    plugin, or ship a documented executable invoked automatically by the
    plugin/prebuild lifecycle. Add an `entry` option and generate/copy the
    bundle as part of prebuild. Validate required Swift entry files.
  - **Acceptance criteria:**
    - A clean external Expo fixture needs only dependency installation, plugin
      configuration, a watch JS entry, and normal signing setup.
    - `expo prebuild --clean` followed by target build succeeds without custom
      package scripts.

- [ ] **CX-013 — native compilation is not a required PR gate**

  - **Area:** CI
  - **Evidence:** the macOS workflow is `workflow_dispatch` only. Linux CI
    cannot compile `ReactWatchHost`, SwiftUI, WidgetKit, CoreBluetooth,
    HealthKit, or target wiring.
  - **Impact:** native-breaking changes can merge while all required checks are
    green.
  - **Fix:** add path-filtered PR/push macOS jobs. At minimum run target-only,
    code-signing-disabled builds for watch and widget. Keep device/signing tests
    separate.
  - **Acceptance criteria:**
    - Native source/plugin changes trigger required watch and widget builds.
    - Widget build failures are not `continue-on-error`.
    - Build logs are retained on failure.

## P2 — API and behavior defects

- [ ] **CX-014 — multiple consumers of one sensor interfere with each other**

  - **Area:** sensors
  - **Evidence:** every `startSensor(kind, handler)` sends `start`; every
    returned cleanup sends `stop`, regardless of other active listeners.
  - **Impact:** unmounting one component stops the shared native stream for all
    remaining subscribers.
  - **Fix:** maintain per-kind subscription counts in JS or native, starting on
    `0 → 1` and stopping on `1 → 0`. Make start/stop idempotent.
  - **Acceptance criteria:** tests cover two subscribers, staggered cleanup,
    duplicate cleanup, and remount.

- [ ] **CX-015 — `Map` region props are public but ignored**

  - **Area:** components/native interpreter
  - **Evidence:** `MapProps` exposes `latitude`, `longitude`, and `span`;
    `NodeView.mapView` only reads annotations, route, and height.
  - **Impact:** consumers believe they can control the visible region, but
    behavior is left to MapKit defaults.
  - **Fix:** implement a camera/position binding or remove the props until
    supported. Define precedence between explicit region, route fit, and
    annotation fit.
  - **Acceptance criteria:** native tests or a compile-verified fixture prove
    every public prop is consumed.

- [ ] **CX-016 — widget snapshot may select a future timeline entry**

  - **Area:** widgets
  - **Evidence:** snapshot helpers use `entries.last`, while timelines may
    contain future-dated daypart entries.
  - **Impact:** gallery/snapshot UI can show the end-of-day state instead of the
    state applicable now.
  - **Fix:** select the latest entry whose date is `<= now`; otherwise select
    the earliest entry.
  - **Acceptance criteria:** tests cover past/current/future-only timelines.

- [ ] **CX-017 — `relevantContexts` is serialized but not applied**

  - **Area:** Smart Stack integration/documentation
  - **Evidence:** Swift exposes a `relevantContexts` property and comments that
    native mapping is a remaining step. Project docs list Smart Stack relevant
    contexts as shipped.
  - **Impact:** public claims exceed implementation.
  - **Fix:** wire contexts to the applicable WidgetKit relevance API, or mark
    the feature experimental/unimplemented and remove shipped claims.
  - **Acceptance criteria:** compile-tested native mapping plus a focused test
    or corrected documentation.

- [ ] **CX-018 — widget and app interpreters have behavioral drift**

  - **Area:** architecture/widgets
  - **Evidence:** duplicated switches differ: widget colors do not support hex;
    widget text ignores `monospacedDigit`; timer millisecond behavior differs;
    fallback behavior must be manually synchronized.
  - **Impact:** the same serialized tree renders differently depending on
    target, and new primitive additions can silently omit widget behavior.
  - **Fix/refactor:** extract shared pure prop parsing/style helpers into
    `ReactWatchCore`/`ReactWatchSupport`, and generate or contract-test the
    primitive support matrix for both interpreters.
  - **Acceptance criteria:**
    - One test enumerates every host component and its app/widget support.
    - Shared color/text/date parsing has one implementation.
    - Intentional widget degradation is documented per component.

- [ ] **CX-019 — remote inspector produces unhandled rejection noise**

  - **Area:** developer tooling
  - **Evidence:** periodic `fetch` promises are ignored.
  - **Impact:** when the inspector server is unavailable, the promise rejection
    tracker can display repeated runtime-error banners every second.
  - **Fix:** catch network errors, rate-limit logging, add a stop handle, clear
    the interval, and permit restart with changed options.
  - **Acceptance criteria:** offline inspector operation produces no unhandled
    rejection and can be stopped/restarted.

- [ ] **CX-020 — example projects do not represent the current public path**

  - **Area:** examples/documentation
  - **Evidence:** `examples/expo-watch-app` configures only
    `@bacons/apple-targets`; its README references old copied plugin paths and
    manual package wiring. `minimal-watch-app` describes `file:../../js` while
    its actual manifest uses `workspace:*`.
  - **Impact:** users following examples do not test or learn the package's
    current config plugin.
  - **Fix:** turn the Expo example into a clean-room package consumer and make
    it the integration-test fixture. Keep workspace substitution only as a
    repository implementation detail.
  - **Acceptance criteria:** documented commands work from a clean checkout and
    CI builds the generated watch target.

- [ ] **CX-021 — fetch is not sufficiently WHATWG-compatible for a public `fetch`**

  - **Area:** networking/API design
  - **Evidence:** response bodies can be read repeatedly; request input accepts
    only a URL string; no `clone`, body-used state, credentials/cache modes, or
    redirect control; non-HTTP schemes are accepted by `FetchPlan`.
  - **Impact:** third-party code may assume browser/RN fetch semantics and
    behave incorrectly.
  - **Decision:** either intentionally expose a smaller `watchFetch` API or
    tighten compatibility and document deviations explicitly.
  - **Acceptance criteria:** API naming/documentation accurately sets the
    compatibility level; supported URL schemes are allowlisted.

- [ ] **CX-022 — production native operations often fail silently**

  - **Area:** error model
  - **Evidence:** BLE malformed ops, unavailable sensors, permission denial,
    WatchConnectivity send failures, notification permission outcomes, and
    storage failures are often dropped or represented only by missing events.
  - **Impact:** apps cannot distinguish success, unavailable capability,
    permission denial, or malformed input.
  - **Fix/refactor:** define a typed native result/error channel. Commands that
    can fail should return promises or emit correlated result events.
  - **Acceptance criteria:** every public native capability documents and tests
    its unavailable, denied, invalid, and runtime-failure paths.

## P3 — maintainability and cleanup

- [ ] **CX-023 — host method schema does not generate the bridge**

  - `hostMethods` is a manifest checked by tests, but `QuickJSHostGlobal`,
    Swift properties, C callbacks, installation code, and wrapper methods remain
    manually duplicated.
  - Generate the repetitive bridge declarations and installation table from a
    typed schema containing argument/result/error forms and runtime targets.

- [ ] **CX-024 — component contract is duplicated across TypeScript and Swift**

  - Component props, event mappings, app rendering, and widget degradation are
    manually synchronized.
  - Extend codegen to define primitives, prop wire types, events, availability,
    and widget support. At minimum generate a contract fixture and exhaustive
    support tests.

- [ ] **CX-025 — OTA compatibility version has multiple manual sources**

  - JS build version and `OTAConfig.shippedVersion` must be changed manually in
    lockstep.
  - Generate native configuration or embed the version in the shipped bundle
    metadata and read it from one source.

- [ ] **CX-026 — duplicated app-specific intent files and identifiers drift**

  - Shopping intent sources and App Group/storage constants are copied between
    targets.
  - Move shared intent models into an app-specific Swift package/product or
    generate both copies from one source/config.

- [ ] **CX-027 — documentation mixes current behavior, plans, and completed claims**

  - `roadmap.md`, `publishing.md`, README files, and the earlier review contain
    contradictory status statements.
  - Split into `status.md` (verified current behavior), `roadmap.md` (future),
    and focused implementation docs. Every "shipped" platform feature should
    link to its test/build evidence.

- [ ] **CX-028 — newly added OTA helper scripts need repository integration**

  - At report-writing time, `js/scripts/ota-keygen.mjs` and
    `js/scripts/ota-sign.mjs` were untracked and failed Biome formatting.
  - Before adoption: format them, add package scripts, add deterministic signing
    tests against Swift verification, document secret handling, and decide
    whether they ship in the npm package or remain repository tooling.

## Recommended execution plan

### Phase 1 — make publishing safe

- [ ] Complete CX-001.
- [ ] Complete CX-002.
- [ ] Complete CX-003.
- [ ] Add a tarball install/build integration test.
- [ ] Cut no release until these gates pass.

### Phase 2 — make OTA coherent

- [ ] Complete CX-004 through CX-009.
- [ ] Add a single bundle identity/version model shared by app and extension.
- [ ] Add fault-injection and runtime-generation tests.
- [ ] Decide and document production fail-closed defaults.

### Phase 3 — harden runtime interaction

- [ ] Complete CX-010, CX-014, CX-019, CX-021, and CX-022.
- [ ] Introduce typed correlated command results.
- [ ] Add lifecycle shutdown to every native bridge.

### Phase 4 — make the consumer path real

- [ ] Complete CX-011 through CX-013 and CX-020.
- [ ] Dogfood the package config plugin from the Expo example.
- [ ] Make native target builds required in CI.

### Phase 5 — reduce contract drift

- [ ] Complete CX-015 through CX-018 and CX-023 through CX-027.
- [ ] Expand codegen from wire structs into primitive and bridge contracts.

## Validation performed during review

- [x] TypeScript typecheck passed for renderer and examples.
- [x] Biome passed on the reviewed tracked JS/TS files.
- [x] Codegen drift check passed.
- [x] JS test suite passed: **189 tests**.
- [x] Example test suites passed.
- [x] SwiftPM test suite passed: **50 tests**.
- [x] QuickJS source-bundle embedding smoke passed.
- [x] QuickJS bytecode compile/load smoke passed.
- [x] Minified bundle-size check passed: **170 KB under 200 KB budget**.
- [x] Xcode 26.3 target-only watch app build passed.
- [x] Xcode 26.3 target-only widget build passed.
- [ ] Physical-device behavior and signing were not verified.
- [ ] App Store submission/review behavior was not verified.

## Handoff instructions

For each checkbox:

1. Reproduce the issue or add a failing test first.
2. Record the final decision when multiple fixes are possible.
3. Implement the smallest coherent change, including public API/docs updates.
4. Run the relevant focused tests and the complete validation suite.
5. Check the item only after its acceptance criteria pass.
6. Add the fixing commit or PR reference beneath the item.
