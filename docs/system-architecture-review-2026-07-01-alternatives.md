# System & architecture review — 2026-07-01 (alternatives edition)

Baseline: `2377ecb` (HEAD of the main line; all 2026-06-27 deep-dive fixes
landed). Method: four parallel deep passes (JS renderer, Swift host, build/DX,
docs-decision digest) reconciled against the merged backlog so nothing below
re-litigates a decided item, plus a fresh July-2026 landscape check on the
engine and UI-framework questions (quickjs-ng, Moddable XS, Hermes V1 /
Static Hermes, SolidJS universal, TC39 signals).

Scope requested: *everything* — code correctness, the architecture itself,
and the big-system alternatives (React vs signals/SolidJS, QuickJS vs XS
Moddable vs others, a full design-system layer). Part 1 is new findings
(`NF-xx`, deduplicated against CR/CX/OP/SD/ARCH/DX and the 06-27 deep-dive;
overlaps are cross-referenced, not re-counted). Part 2 is the strategic
analysis. Part 3 is the recommended plan.

Honest caveat (Rule 12): every finding here is from static analysis + the
Linux test suite. Nothing was run on a device or simulator in this pass; the
perf claims are reasoned, not profiled — which is itself finding NF-20.

---

## Executive verdict

The core architecture — QuickJS-ng on-watch, React 19 via a
`react-reconciler` host config, full-JSON-tree commits into a SwiftUI
interpreter, seq-acked optimistic inputs, React-authored WidgetKit timelines
— **remains the right shape and survives adversarial comparison against
every 2026 alternative checked**. No finding below says "rewrite it".

Three structural conclusions, argued in Part 2:

1. **Engine: keep quickjs-ng.** The XS/Moddable one-line rejection in
   research.md is now a fully-argued rejection: LGPLv3 relink mechanics are
   effectively incompatible with App Store distribution for an OSS package
   whose *consumers* would inherit the obligation, the toolchain is
   manifest-shaped rather than embed-shaped, and `arm64_32` is unproven.
   Hermes still has no watchOS target and its ILP32 story makes one
   unlikely; QuickJS's plain-C portability is precisely why this project
   can exist. Revisit triggers documented below.
2. **UI model: keep React — because the expensive part is the wire, and the
   wire can be fixed *inside* React.** The strongest pro-signals argument
   (full-tree serialize per commit) is a property of `serialize.ts`, not of
   React: the mutation-mode host config already hands us the exact
   per-node mutation stream (`commitUpdate`/`appendChild`/…) that a patch
   protocol needs, and today we throw it away and re-walk the tree. A
   SolidJS rewrite would buy a smaller runtime and no reconciler pin, at
   the cost of the project's entire "it's just React" pitch — and it would
   still need the same patch wire protocol. Decision point = protocol, not
   framework.
3. **Design system: the missing layer is real and cheap.** 25 primitives
   with `spacing`-only layout, raw color strings, no padding/frame/
   background, no tokens, no animation surface is the biggest gap between
   "demo" and "product". A two-tier answer (thin SwiftUI-modifier
   passthrough + a JS-side semantic token/theme layer that resolves at
   serialize time, zero native changes for tier 2) is specced in §2.4.

And one process conclusion: the project's *measurement discipline lags its
design discipline*. The tree-diff decision rests on a V8 benchmark
(NF-20), the macOS build is not PR-gated while the pbxproj surgery is the
most fragile code in the repo (NF-30 vs CX-013), and the publish pipeline
doesn't include the package at all (NF-27). The architecture is ahead of
its verification.

---

## Part 1 — New findings

Severity: **[C]** critical · **[M]** major · **[m]** minor · **[i]** idea.
Format: finding → failure → fix. File refs are repo-relative to
`projects/react-native-watchos/`.

### 1.1 Correctness — JS runtime

**NF-01 [M] Generic `invoke` promises have no JS-side timeout; a
present-but-silent host hangs them forever.**
`js/src/invoke.ts:32-104` — `pending` is drained only by
`__resolveInvoke`/`__rejectInvoke`. CX-022 fixed the *native* side settling
its known failure paths (`d66bff7`, `b35cfb5`), but the JS side still has no
last-resort timer, so any future native path that accepts an invoke and then
drops it (an exception before the callback, a delegate that never fires)
strands the promise and leaks the closure for the runtime's life. The doc
comment "never hangs" is only true for the unrouted-method branch.
Fix: arm a per-id `setTimeout` (generous, e.g. 30 s; BLE connect already has
its own 15 s) that rejects `INTERNAL` and deletes the entry; clear on settle.
This is defense-in-depth *below* the per-bridge fixes, so the invariant
stops depending on every future bridge author's diligence. (`generateText`'s
missing timeout/abort is already on the backlog — deep-dive; same shape.)

**NF-02 [M] `flush()` doesn't drain cascaded passive effects, so the
synchronous-commit contract has a two-deep hole.**
`js/src/renderer.ts:330-341` — `flushSyncWork(); flushPassiveEffects();
flushSyncWork()`. If a `useEffect` sets state (flushed by the second
`flushSyncWork`) and *that* commit schedules further passive effects (effect
A subscribes → setState → effect B — a common cascade), the second
generation is left to the scheduler's next turn. Two consequences: the
"commits before the native call returns" contract of
`dispatchEvent`/`runSync` silently degrades to "mostly", and an
`uncaughtError` thrown inside the un-flushed second-generation effect misses
the `this.uncaughtError` check, weakening fail-loud.
Fix: loop — `do { flushSyncWork() } while (flushPassiveEffects())` — then
check `uncaughtError`. `flushPassiveEffects` returns whether it did work, so
the loop terminates.
**Correction (2026-07-02, verified by experiment):** the loop is *not* the
fix — React forces update priority to Default while passive effects run,
so effect-scheduled renders inherently land on later scheduler turns (the
README's documented one-hop model); no synchronous flush can pull them
forward. The real defect is the error path: those scheduler-turn commits
never pass through `flush()`, so their `uncaughtError` sat until the next
native event. Fixed by a microtask rethrow fallback in `onUncaughtError`
(no-op when a sync flush consumes the error first), with tests pinning
both the staged cascade semantics and the surfacing.

**NF-03 [m] `setInterval` drifts and dies silently on a throwing callback.**
`js/src/shims.ts:48-69` — the re-arm happens *after* `timer.run()` returns,
so the effective period is `intervalMs + callback + host round-trip`
(cumulative drift), and a throw skips the re-arm line entirely: the interval
permanently stops with no diagnostic. A JS-driven seconds clock will drift
and can freeze.
Fix: re-arm in a `try/finally` around `run()`; optionally schedule from the
intended-next-fire timestamp instead of "now" to make it fixed-rate.

**NF-04 [m] Timer delays are forwarded to native unclamped.**
`js/src/shims.ts:37,52` — `ms ?? 0` passes negative/`NaN` delays to
`host.setTimer` verbatim. Clamp with `Math.max(0, Number(ms) || 0)`.

**NF-05 [m] `runApp` re-entry orphans the previous root.**
`js/src/index.ts:208-234` — a second `runApp` call reassigns
`__dispatchEvent`/`__pushNativeEvent`/`__inspect` and abandons the old
`WatchRoot` un-unmounted (container + instance map retained). Nothing calls
it twice today; the dev hot-restart path replaces the whole runtime instead —
but the API allows it. Guard (throw) or unmount the previous root.

**NF-06 [m] Single-root enforcement throws mid-commit.**
`js/src/serialize.ts:33-39` — the multiple-roots throw runs inside
`resetAfterCommit`, i.e. during React's commit phase, which can leave the
fiber tree partially committed for the next render. Fail loud is right;
fail at render/scheduling time (e.g. validate in `appendChildToContainer`)
is safer.

**NF-07 [m] Priority is restored *before* the flush it governs.**
`js/src/renderer.ts:285-291,315-326` — both `dispatchEvent` and `runSync`
restore `currentUpdatePriority` in the `finally` and *then* call `flush()`,
so work newly scheduled during the flush (e.g. from an effect) resolves at
the restored default priority. Works today because the discrete work was
scheduled inside the callback; fragile against reconciler minors. Restore
after the flush.

**NF-08 [i] Stale/duplicate-seq redelivery is un-acked by the dedup — but
provably harmless today.** `js/src/renderer.ts:231,279-305` — a duplicate
event (`seq <= lastSeq`) with a no-op handler forces `onCommit()`, whose
byte-identical JSON is deduped, so no ack is sent for *that* delivery.
Analysis: acks are monotonic (`ack(throughSeq:)`,
`OptimisticStore.ack`), and the *first* delivery of that seq was
guaranteed-acked (CX-010), so the optimistic store already released
everything ≤ `lastSeq`; nothing strands. Recording the reasoning here so the
next reviewer doesn't re-derive it — and as a warning: if per-seq
(non-monotonic) ack semantics are ever introduced, this dedup becomes a real
bug. A pinning test would be cheap.

### 1.2 Correctness — Swift host

**NF-09 [M] `bootedOTARecord` is never cleared in `boot()`, so a stale
record can be promoted to known-good.** Verified:
`js/swift/Sources/ReactWatchHost/ReactWatchHost.swift:227` declares it, it
is only ever *assigned* in the `.runOTA` branches (`:729,:757`), and
`boot()` resets generation/root/ackedSeq/optimistic but not this field. A
later `.runShipped` or DEBUG `boot(devCode:)` boot retains the previous OTA
record; the first-healthy-commit handler (`:897-905`) can then
`promoteToKnownGood` a bundle that is not the one actually running —
corrupting the crash-loop rollback target. Fix: `bootedOTARecord = nil` at
the top of `boot()`. Two lines, high value.

**NF-10 [M] The OTA validator runs untrusted top-level code with no memory
cap.** `ReactWatchHost.swift:459` — `persistOTA` validates with
`try? JSRuntime()` (default `memoryLimitBytes: nil`), while the *live*
runtime is capped at 64 MB (`makeRuntime`, `:859`) for exactly this reason.
`maxOTABundleBytes` caps source size (3 MB), not allocation: a small bundle
whose module-init allocates unboundedly OOM-kills the app *during
validation*, before persist/rollback protections exist. Same for the
`compileToBytecode` runtime (`:494`). Fix: pass the same cap (or smaller)
to both throwaway runtimes.

**NF-11 [M] Synchronous cross-process file coordination on the main thread
inside a JS→host call.** `ReactWatchHost.swift:919-922` wires
`counterGet`/`counterAdd` straight to `CoordinatedCounterStore`
(`CoordinatedCounterStore.swift:107-123`), whose claims block under
`NSFileCoordinator`. The trampoline is synchronous and the app's QuickJS
runs on the main thread → a counter increment while the widget process
holds a write claim stalls UI *and* engine. Fix: route counter mutations
through `invoke` (async settle on a serial queue), or bound the claim and
document the worst case. Note the same synchronous-main-thread shape also
holds for `getItem`/`setItem` App-Group UserDefaults, which are fast — the
file-coordination path is the one with unbounded cross-process wait.

**NF-12 [M→m] Widget timers are scheduled on the wrong queue (upgrade of a
known finding).** `js/swift/Sources/ReactWatchRuntime/JSRuntime.swift:409-419`
hardcodes `DispatchQueue.main` for `setTimer`, while the widget's runtime is
created and driven off-main (`WidgetIntentRuntime.swift:171,182`) with no
`assertMainThread`. The deep-dive recorded "widget timers never fire"; the
sharper point is that if one ever *did* fire it would touch the QuickJS heap
from a second thread — a data race, currently masked only by the runtime
being a short-lived local. Fix: the runtime should capture its owning queue
at init and schedule timers there; that converts "unsound but masked" into
"correct on both targets" and is a prerequisite for any future long-lived
widget runtime.

**NF-13 [m] BLE binary payloads are silently destroyed in both directions.**
`BluetoothBridge.swift:451-459` — notify values go through
`String(data:encoding:.utf8) ?? ""`, so any non-UTF-8 characteristic value
arrives in JS as an empty string; writes take `Data(value.utf8)` (`:287`),
so JS cannot send binary at all. The fetch path already solved exactly this
with a base64 fallback + flag (`FetchPlan.swift:44-77`). Apply the same
encoding contract to BLE (payload + `binary: true`), and extend
`bleWrite` to accept base64. (The quote-only JSON escaping in `reject` is
already on the backlog — deep-dive.)

**NF-14 [m] Late `onError` from a dead runtime can paint the new
generation's error banner.** `ReactWatchHost.swift:935-937` hops to main and
sets `runtimeError` without the `gen == self.generation` check every other
async settle has (CX-008 discipline). Two-line fix, consistency win.

**NF-15 [m] `warnedWireMismatch` latches across boots.**
`ReactWatchHost.swift:52-53,884-892` — after one wire-version mismatch the
flag stays true for the model's lifetime, so a *second* bad bundle (dev
hot-reload) is rejected with no banner. Reset in `boot()`.

**NF-16 [m] No JS stack-size configuration.** `JSRuntime.swift:57-75` sets a
memory limit but never `JS_SetMaxStackSize`; deep recursion in a bundle is a
native `SIGSEGV` instead of a catchable `RangeError` — a fail-loud hole on
the exact runtime whose init comment promises loud failure. Set an explicit
stack size sized to the hosting thread.

**NF-17 [m] Widget `getTimeline` can lead with stale entries.**
`ReactWatchWidget/ReactTimeline.swift:50-65` maps published entries
unfiltered, while `reactSnapshotEntry` (`:71-81`) correctly uses
`WidgetSnapshot.currentIndex`. A JS timeline whose leading entries are
already past shows an out-of-date first frame until WidgetKit advances.
Filter `[currentIndex...]` for parity.

**NF-18 [m] Container-level a11y props are silently ignored.**
`NodeView.swift:692-708` — `accessibilityLabel`/`Hint` on a
`VStack`/`HStack`/`List` does nothing without
`.accessibilityElement(children: .combine)`. Either combine when a
container carries a11y props, or type-restrict a11y props to leaves so the
contract is honest.

**NF-19 [m] Unset `Text` color is pinned to `.primary`, defeating
inherited tint/vibrancy.** `NodeView.swift:255`,
`WidgetNodeView.swift:189` — `foregroundStyle(color(...) ?? .primary)`
overrides the environment even inside tinted buttons and vibrant/redacted
widget rendering modes. Apply `foregroundStyle` only when a color prop is
present.

### 1.3 Performance & measurement

**NF-20 [M] The "no patch protocol needed" decision rests on a V8
measurement; the shipping engine is an interpreter.**
`js/test/treediff.bench.test.tsx` runs under vitest/Node (JIT V8) and its
~0.04 ms/serialize figure is baked into prior-art.md/roadmap as the reason
tree-diffing was dropped. QuickJS on a watch SoC is plausibly 10–100×
slower on this allocation/string-heavy path, and the bench serializes a
single flat 200-row list — not the eager-mounted all-screens tree that
actually ships (ARCH-09: the demo commits all 14 screens' nodes on every
state change). The *regression guard* is fine; the *architectural
conclusion* is unsupported. Fix (cheap, this week): port the bench into the
existing `qjs` smoke harness so CI produces an interpreter-engine number,
and re-run the decision against it. Fix (real): one on-device profile of
commit cost at realistic tree sizes — this is the number the whole
protocol question hangs on (see §2.3).

**NF-21 [M] The no-op-commit bailout still pays the full serialize +
stringify.** `js/src/renderer.ts:223-231` — `serializeTree` +
`JSON.stringify` run *before* the `json === lastCommitJson` check, so a
re-render that changes nothing pays O(tree) work in the interpreted engine;
only the native decode is saved. Combined with NF-20's eager-mounted tree,
"cheap no-op commit" is only half true. A dirty-flag in the host config
(any `commitUpdate`/`append`/`remove` since last commit?) can skip
serialization entirely for true no-ops — the reconciler already tells us.

**NF-22 [M] High-frequency native pushes drive the full pipeline per
sample, and the Swift side re-publishes even identical trees.**
JS: each sensor/BLE-notify sample → `__pushNativeEvent` → `runSync` →
full-tree serialize (NF-21). Swift: `ReactWatchHost.swift:893` assigns
`self.root = tree.root` unconditionally — `@Published` fires
`objectWillChange` regardless of equality (`RNNode` *is* `Equatable`),
re-diffing SwiftUI on every commit. CoreMotion at 10 Hz
(`SensorBridge.swift:66,135`) ≈ 10 full pipelines/sec while a sensor screen
is up. Fixes, independently valuable: (a) `if tree.root != root` guard in
Swift; (b) coalesce sensor pushes (deliver at most one per N ms, latest
wins) at the bridge; (c) NF-21's dirty-flag. This is also the concrete
scenario where the §2.3 patch protocol earns its keep.

**NF-23 [m] `drainJobs` has no bound.** `JSRuntime.swift:427-442` — a
runaway microtask chain livelocks the shared UI/engine thread. An iteration
cap (say 10k) with a loud `JSError` converts a frozen watch into a
diagnosable crash.

**NF-24 [m] Bundle target is es2020 against an ES2023 engine.**
`js/esbuild/preset.mjs:53` justifies es2020 with "both Bellard quickjs and
quickjs-ng cover it", but only quickjs-ng v0.15.1 is vendored
(`tools/vendor-quickjs`). Down-leveling `??=`, class fields etc. inflates
the bundle against its own size budget. Raise to es2022/es2023 after a qjs
smoke run, or correct the comment.

**NF-25 [m] Dev hot-reload re-downloads the full bundle every 2 s and
string-compares.** `ReactWatchHost.swift:1122-1145` — no
ETag/`If-None-Match`, `reloadIgnoringLocalCacheData`, 1.5 s timeout, full-
body compare against `lastDevBundle`. Fine on simulator; wasteful and laggy
on a physical watch over LAN. esbuild's serve can answer a `HEAD`/ETag; or
serve a tiny `/rev` counter.

### 1.4 Packaging, CI, distribution

**NF-26 [C] The example-consumer CI step invokes a script that does not
exist — the gate fails (or silently never ran) on every push.** Verified:
`.github/workflows/react-native-watchos-ci.yml:58` runs
`pnpm --filter expo-watch-app build:watch`;
`examples/expo-watch-app/package.json` defines `build:targets`. Either CI
has been red on this step since the rename, or the step's failure is being
masked — both are bad. Fix the name; add a
`pnpm -r --if-present run <script>`-style guard nowhere (fail loud is
correct here).

**NF-27 [C] The package is absent from the release/publish automation
entirely.** Verified: `release-please-config.json` /
`.release-please-manifest.json` / `.github/workflows/publish.yml` cover only
`projects/flatbuffers/*`. Every consumer-facing doc (README "Consuming it in
your own app", publishing.md) assumes an npm-installable package; today
nothing can publish it — no version bumping, no changelog, no provenance
publish. Fix: add `projects/react-native-watchos/js` to release-please +
the publish workflow, add `publishConfig`, a `prepublishOnly` gate
(typecheck+lint+test+check:size), and a CHANGELOG seed.

**NF-28 [M] The React Compiler is repo-only; consumers using the published
preset silently don't get it.** `js/esbuild/preset.mjs:38-71` defaults
`plugins: []`; `reactCompilerPlugin` is injected only by the demo's
`scripts/config.mjs:78`. The compiler's whole stated rationale (fewer
re-renders → fewer bridge trips) is a *consumer* benefit, and the README
advertises it as an architecture property. Worse,
`react-compiler-plugin.mjs:20` bails on `node_modules`, so the package's own
`navigation.tsx` components are never compiled for an installed consumer.
Fix: `watchBuildOptions({ reactCompiler: true })` that lazy-loads
babel + the plugin (documented peer), and drop the `node_modules` bail for
paths inside `react-native-watchos` itself.

**NF-29 [M] Every shipped example is unsigned-OTA; combined with the
fail-open default this is a copy-paste RCE footgun.** With empty
`signerPublicKeys` the host loads unsigned bundles with only a warning
(`ReactWatchHost.swift:1159`; documented posture, CX-003 three-state is
fine *for the repo*), and `examples/expo-watch-app/scripts/serve-ota.mjs`
serves `signature: null` manifests. A consumer who copies the example gets
a live "any origin that answers the manifest URL owns the watch app" path.
Keep dev fail-open if you must, but make the *examples* model the secure
path: generate a dev keypair in the example's setup script, sign in
`build-targets.mjs`, and make unsigned loading require an explicit
`allowUnsigned: true` in `OTAConfig` rather than being the zero-config
default.

**NF-30 [M] The most fragile code in the repo (pbxproj surgery) is guarded
by the least CI.** `js/plugin/withNativeWiring.js:104-123` and
`wireLocalPackage.js:107-121` depend on @bacons/apple-targets internals
(base-mod registration order, "no Frameworks phase" assumption, generated
plist timing) with a loose `>=4.0.0` peer range
(`js/package.json:91`) — while the macOS build that would catch a break is
`workflow_dispatch`-only (CX-013, a deliberate skip decided when the plugin
was simpler). Cheap mitigations that don't reopen CX-013: pin apple-targets
to a tested minor range; add a Linux-runnable *pbxproj-shape* test (run
`expo prebuild` in CI with a stub SDK? no — instead snapshot the plugin's
edits against a checked-in fixture pbxproj, which needs no Xcode); schedule
the full macOS build nightly instead of manual-only.

**NF-31 [M] apple-targets' silent `infoPlist` drop is patched by a re-merge
that can itself silently no-op.** `js/plugin/withNativeWiring.js:32-49` +
`mergeInfoPlist.js` — `mergeTargetInfoPlists` *skips* if the generated
`Info.plist` isn't present when the base mod fires. If apple-targets' write
ordering shifts, `WKRunsIndependentlyOfCompanionApp`, the `reactwatch://`
URL scheme, and usage strings vanish from the build with no error —
exactly the class of silent failure `a8d5a82` just fixed for SwiftPM
linking. Fail loud (or create the plist) when a target declares `infoPlist`
and none is found.

**NF-32 [m] OTA freshness can be suppressed by an unsigned manifest
(freeze attack), and manifest fields are shape-unvalidated.**
`js/src/update.ts:197-217` — only the *bundle* is signed; the manifest JSON
is not, so an on-path attacker can pin clients to "up to date" forever
(anti-rollback stops downgrades, not suppression). Also
`manifest.version` is used in numeric comparisons unvalidated — a malformed
manifest yields silent "up to date". Validate shape loudly; document the
freeze exposure (the fix — signing the manifest — is already half-built:
`signedMessage` covers version+js; extending it to cover the manifest body
is a schema change, cheap pre-release per CLAUDE.md rule 1).

**NF-33 [m] Native OTA path downloads before it checks.**
`ReactWatchHost.swift:589-601` — `checkForUpdateNatively` materializes the
whole bundle (`URLSession.shared.data`) with no size cap before
`saveUpdate` enforces `maxOTABundleBytes`; and
`URL(string: manifest.bundle, relativeTo:)` lets a manifest redirect the
bundle fetch to an arbitrary host. Cap the response; consider same-origin
enforcement for the bundle URL.

**NF-34 [m] `fetch` host path: no per-request timeout, headers forwarded
verbatim.** `ReactWatchHost.swift:1022-1087` / `FetchPlan.swift:22-41` —
default 60 s socket hangs tie up a fetch slot on a watch; JS-supplied
hop-by-hop headers pass through. Set a shorter `timeoutInterval` default
(JS layer already has an abortable timeout — align them) and normalize
headers.

**NF-35 [m] Load-time OTA trust is sandbox-only and the stored record is
pinned by a non-cryptographic hash — fine, but undocumented as a trust
boundary.** `ReactWatchHost.swift:794-830` deliberately skips signature
re-verification at load ("trusts the App Group", CR-17 posture) and pairs
source↔bytecode via FNV-1a `ContentHash`. Anyone who can write the App
Group container owns the runtime. That's a defensible Apple-sandbox
assumption, but it should be one documented sentence in ota-signing.md —
and since the stored record already carries `signature`/`keyId`/`version`,
re-verifying at boot is nearly free and removes the boundary entirely.
Recommend doing it rather than documenting around it.

**NF-36 [m] Smaller DX items.** Dev server builds/watches only the app
bundle, never the widget bundle (`js/scripts/dev.mjs:14` → `targets[0]`);
bytecode (`.qbc`) is a repo-only optimization with no published consumer
path (`tools/qjs-compile`); the published preset defines only
`NODE_ENV`/`BUNDLE_VERSION`, so any other `process.env.X` in consumer code
is a `ReferenceError` at eval (document or default-define);
`readTargets.cjs:21` invokes function-form `expo-target.config.js` with
`{}` (hand-authored function configs will misbehave — try/catch + skip);
exact `react-reconciler@0.33.0` peer pin is the dedupe footgun ARCH-14
predicted (widen to `~0.33.0` + a runtime dual-copy assertion);
`main`/`types` → `.ts` source breaks any non-transpiling consumer (a
documented tradeoff — but say it in the README, "esbuild/Metro-class
bundler required").

### 1.5 Test-gap notes (no code change, add pins)

- The optimistic-release contract ("JS always emits a commit carrying the
  dispatch's seq") is stated in a NodeView comment but pinned by no JS
  test (`NodeView.swift:340-345`; NF-08's analysis relies on it).
- `RouteMatcher.swift` and `js/src/navigation.ts matchRoute` are two
  hand-kept implementations of route scoring with no cross-language
  conformance test (the fixture-drift harness already exists — add route
  cases to it).
- No test exercises the high-frequency push → commit path at all (NF-22).
- `cachedGlobalFunction` (`JSRuntime.swift:374-385`) silently assumes
  bundle globals are never reassigned — one comment, or one cache-bust on
  re-eval, makes it explicit.

---

## Part 2 — Strategic alternatives (the "big system change" analysis)

### 2.1 Engine: quickjs-ng vs XS Moddable vs Hermes vs the field (2026-07)

The research.md table (2026-06-11) holds up; this section upgrades the
one-line verdicts with what a real migration would mean, since the user
question was explicitly "think about everything, big changes allowed".

**Moddable XS — rejected, now with the full argument.**
- *License is the killer, and it's structural, not FUD.* XS's runtime is
  LGPLv3 (tools GPLv3; commercial licenses exist). LGPLv3 §4 requires that
  end users be able to relink the application against a modified library.
  On watchOS there is no dynamic loading and no user relinking — an App
  Store binary is signed and sealed — so LGPL compliance for a
  statically-linked XS effectively requires either publishing enough
  object code for relinking (impractical inside App Store packaging) or a
  commercial license. Crucially, *this project is an npm package*: the
  obligation would flow to every consumer's app. quickjs-ng is MIT;
  consumers inherit nothing. This alone ends the discussion for an OSS
  package, independent of technical merit. ([moddable.com/license](https://www.moddable.com/license))
- *Technical shape mismatch.* XS is genuinely excellent — ~99% ES2025
  conformance, runs in 32 KB RAM, and its preload/freeze mechanism (build
  closures into ROM-able slots, near-zero cold start) is the strongest
  cold-boot story in the class, strictly better than our `.qbc`. But the
  Moddable SDK is manifest-driven (`mcconfig`, module maps, `xst`): the
  embedding unit is "a Moddable app", not "drop these C files into your
  target". We'd trade `tools/vendor-quickjs` + `tools/qjs-compile` +
  `CQuickJS` for a bigger foreign build system, lose esbuild's
  IIFE+`inject` model, and be the first project on earth running XS on
  `arm64_32` watchOS. The watch has ~1 GB RAM: XS's one unique advantage
  (tiny RAM) buys nothing here.
- *Performance:* XS optimizes for footprint, not throughput; QuickJS is
  generally the faster interpreter of the two on string/object-heavy work
  (our profile). No win there either.
- Verdict: **rejected on license + shape + unproven target; nothing to
  revisit unless Moddable relicenses the runtime.**

**Hermes / Static Hermes — still "future work", and the window may never
open.** RN 0.84 (2026-02) made Hermes V1 the default engine and Static
Hermes remains research-stage (not cleanly installable as of 2026-04
third-party reports). Still no watchOS target upstream. New argument this
review adds: **ILP32.** Apple Watch models before S9 run `arm64_32`
(64-bit registers, 32-bit pointers). Hermes has no ILP32 support story;
quickjs-ng is plain portable C that compiles for `arm64_32` today. A
Hermes port would either drop pre-S9 watches or fund an ILP32 port of a
JIT-less VM — for a gain (AOT bytecode, better GC) whose first half we
already have via `.qbc`. Keep the `HostBridge`/engine seam (it's clean —
`JSRuntime` is 529 lines), keep the roadmap line, expect it never to fire.
([reactnative.dev 0.84](https://reactnative.dev/blog/2026/02/11/react-native-0.84))

**JavaScriptCore** — unchanged: not shipped on watchOS, static WebKit build
is enormous, and JSC-minus-JIT loses most of its advantage anyway. No.

**The long tail** — Duktape/JerryScript/Espruino stand rejected
(research.md). Newer entrants (Boa, Kiesel, LibJS, porffor) are all
pre-production and/or Rust/Zig toolchains with weak-to-absent `arm64_32`
stories. Not candidates.

**quickjs-ng residual risks, named honestly:** (a) bytecode/version
coupling — mitigated by hash-refusal + regenerate-at-package-time, but
NF-36 notes consumers can't produce `.qbc` at all yet; (b) fork-of-a-fork
governance — quickjs-ng is the active community fork and upstream Bellard
continues separately (2025-09 release); the vendoring script isolates us
from either's churn; (c) no JIT — irrelevant, Apple forbids it.
**Decision: keep. Confidence: high.**

### 2.2 UI model: React vs SolidJS/signals vs the field

First, an honest framing the README earns: because this is *not* RN-core,
**no React ecosystem library runs here anyway**. The network-effect
argument for React is therefore weaker than in React Native — what React
actually buys is (1) developer familiarity + the enormous "how do I do X in
React hooks" knowledge base (human and LLM), (2) the product pitch ("write
your watch app in React"), (3) a battle-tested scheduler/reconciler, (4)
the React Compiler. That's still a lot; but it's DX capital, not
ecosystem capital.

**What signals would actually win (verified against the code, not vibes):**
the three hot paths are all fine-grained-update problems — high-frequency
native pushes (NF-22), controlled inputs (crown/slider `change` storms),
and the eager-mounted route tree (ARCH-09). Under SolidJS a sensor sample
updates one signal bound to one `Text` and could emit a one-node wire
patch; under today's code it re-renders and re-serializes the world.

**The pivotal observation: React is not the bottleneck — `serialize.ts`
is.** The host config runs in mutation mode; react-reconciler *already
delivers* the exact fine-grained mutation stream
(`commitUpdate`/`appendChild`/`removeChild`/`insertBefore`/
`commitTextUpdate`) that a patch protocol needs. The current renderer
ignores those callbacks' information content and re-walks the whole tree in
`resetAfterCommit`. That was the right v1 simplification (tens of nodes,
Raycast-pattern precedent) — but it means **the signals argument is
actually a wire-protocol argument in disguise. React can emit deltas
today.** Raycast itself ships React + JSON-patch diffs, at scale. What
signals additionally save is the VDOM re-render cost *inside* JS — real,
but it's the smaller number at watch tree sizes, it shrinks further under
the React Compiler, and it's exactly what NF-20's missing measurement
would quantify.

**Cost of a Solid rewrite, itemized:** rewrite `renderer.ts` +
`serialize.ts` (~700 LOC) as a `solid-js/universal` `createRenderer`
(babel-preset-solid, `generate: "universal"` — mature, documented API);
rewrite every hooks-consuming piece: `navigation.tsx` (context + hooks →
Solid context + signals), `widgets.ts` render functions, all demo/examples,
`testing` utilities; retool the build (drop React Compiler, add
babel-preset-solid — net simpler: kills the reconciler exact-pin, the
dual-React dedupe machinery, `nodePaths`, `preserveSymlinks` lore);
re-teach every doc; rename the project's core promise. What survives
untouched: the entire Swift side, the wire schema + codegen, `shims.ts`,
`fetch/invoke/storage/ble/sensors`, `events.ts` (node-id keyed, framework
agnostic), the seq-ack design, widgets/OTA/plugin. Call it 2–4 weeks of
focused work plus the positioning cost.

**The field, briefly:** Preact+fake-DOM stays the documented *size*
fallback only — it's still a VDOM full-diff, solving nothing architectural.
Svelte 5 runes compile to DOM operations with no supported universal
target — no. Vue's custom-renderer API is VDOM (vapor mode has no custom-
renderer story yet) — no. A hand-rolled signal core (`alien-signals`,
`@preact/signals-core`, TC39 polyfill) + bespoke component layer is
inventing a framework with none of React's or Solid's assets — no. TC39
Signals remains **Stage 1** (validation phase, explicitly not advancing
soon) — nothing to standardize on yet.

**Decision: keep React; make the protocol the seam.** Concretely:
1. Get the real number (NF-20: qjs-engine bench in CI now, device profile
   at first opportunity).
2. Implement the cheap React-side wins that need no protocol change:
   dirty-flag no-op skip (NF-21), Swift equality guard + sensor coalescing
   (NF-22), publish the React Compiler to consumers (NF-28).
3. If and when the measured number says full-tree costs frames: add
   **commit protocol v2 — per-node patches** (`{set: [{id, props}], insert:
   […], remove: […], seq}`) *behind the existing `HostBridge` seam*,
   emitted straight from the host-config mutation callbacks, applied by an
   `RNNode`-store on the Swift side. Wire schema is codegen'd already;
   this is an additive schema change, pre-release, no compat shims
   (CLAUDE.md rule 1). Raycast-proven shape.
4. Reconsider Solid only if a *different* constraint bites (bundle size
   floor ~130 KB of React+reconciler, or JS-side re-render cost measured
   as dominant after the compiler) — and if so, do it after v2 exists, so
   the swap is renderer-only and the Swift host never knows.

### 2.3 The wire protocol is the real architecture decision

Restating §2.2's conclusion as its own section because every alternative
(React-with-patches, Solid, even a future Hermes) converges on it: the
system's one scalability cliff is "commit = serialize the world". The seam
is already perfect — `__host.commit` is one generated method, node ids are
stable, the interpreter keys SwiftUI identity on them (`NodeView.swift:
192-196`), and the seq-ack rides in the same payload. Protocol v2 (patch
list, above) is ~2–3 focused days on each side plus tests, *after* the
measurement justifies it. Do not build it speculatively (Rule 2); do
un-block the measurement (NF-20) immediately, because right now the
decision is being made by a benchmark from the wrong engine.

### 2.4 A full design-system layer (the missing product surface)

Today: 25 primitives; containers expose `spacing` only; no
padding/frame/background/cornerRadius/opacity/alignment; `color` is a raw
SwiftUI-name-or-hex string; `size` in points; no theme, no tokens, no
variants, no animation surface, a11y = label+hint, focus = one boolean.
Every screen hard-codes magic numbers (`demo/App.tsx` throughout). No doc
covers theming (docs digest confirms the gap). Proposal, two tiers +
explicit non-goals:

**Tier 1 — modifier passthrough (native change, small).** Add the ~8
SwiftUI modifiers a watch app actually needs as first-class optional props
on every visual node: `padding` (scalar or `{h,v}`), `frame`
(`{width,height,maxWidth}`), `background` (color token), `cornerRadius`,
`opacity`, `tint`, `alignment` on stacks (`ZStack(alignment:)` above all),
`fontWeight`/`monospacedDigit` beyond Text where sensible. One `Modifiers`
struct in the schema → codegen'd both sides → one `applyModifiers()` in
`NodeView`/`WidgetNodeView` (via the shared `RNStyle`, per ARCH-10). This
is vocabulary completion, not a design system — but it's the prerequisite.

**Tier 2 — semantic tokens, resolved in JS (zero native change).**
A `createTheme` + `<ThemeProvider>` in the package:
- **Scales:** `space` (e.g. `xs..xl` → 2/4/6/8/12), `type` (maps to
  SwiftUI `textStyle`, which already exists and respects Dynamic Type —
  the token layer *forbids* raw `size` except via an escape hatch),
  `colors` (semantic: `accent`, `positive`, `warning`, `muted`, … →
  resolved to SwiftUI semantic styles/hex at serialize time).
- **Variants:** `<Text variant="title">`, `<Button variant="destructive">`
  — sugar that expands to token props before serialization.
- Resolution happens **JS-side at serialize time**, so the wire and the
  Swift interpreter are untouched; theming is a pure-JS feature and
  Linux-testable. Watch-specific reality baked in: watchOS is always-dark,
  so the theme axis is *tint/accent*, not light/dark; Dynamic Type flows
  through `textStyle` for free.
- **Why not Tamagui/NativeWind-style compile-time styling:** those exist
  to optimize CSS-in-JS extraction for RN/web. Here a "style" is already
  just serialized props on a wire node — there is nothing to extract or
  optimize. A context + token-resolution layer is the whole feature
  (Rule 2).

**Animation (the other half of "feels native").** Two additive wire
fields, both mapping to SwiftUI's native machinery, keeping the
"describe it once, let native run it" principle: (a) per-node
`animation: {kind: "spring"|"ease", duration?}` → `.animation(_, value:)`
scoped to that node's prop changes; (b) per-commit `transition` hint (the
tree already carries `seq`; add an optional `anim` field) →
`withAnimation {}` around the `root` assignment for state changes that
should animate as a unit. Route pushes already animate natively. Explicit
non-goals: gesture-driven/interruptible animation APIs, keyframes — out of
scope until a real app needs them.

**A11y completion (small, high leverage):** add `traits`
(button/header/…), `value` (for Gauge/Slider VoiceOver), and honor
container labels via `.accessibilityElement(children: .combine)` (NF-18).
Focus: the roadmap P2 item stands; the token layer shouldn't wait for it.

Sequencing note: Tier 1 + a11y before Tier 2 (tokens want the modifiers to
resolve onto); animation orthogonal. Total is product-shaping work, not
plumbing — it's what makes the 26th consumer screen look like a watch app
instead of a debug view.

---

## Part 3 — Recommended plan

Ordered; each item independently shippable. (P0 ≈ this week, P1 ≈ next,
P2 = when measurement/product demands.)

**P0 — correctness & credibility**
1. NF-26 fix the CI script name (one line; the consumer gate is dark).
2. NF-09 `bootedOTARecord = nil` in `boot()` (rollback-target corruption).
3. NF-10 memory-cap the OTA validator + bytecode runtimes.
4. NF-02 loop `flushPassiveEffects` in `flush()`.
5. NF-01 JS-side invoke timeout net; NF-03/NF-04 shim hardening.
6. NF-29 sign the examples' OTA + `allowUnsigned` opt-in.
7. NF-20 port the tree bench into the `qjs` harness (the number that
   governs §2.3).

**P1 — performance floor & packaging**
8. NF-21 dirty-flag no-op skip; NF-22 Swift equality guard + sensor
   coalescing.
9. NF-28 React Compiler in the published preset.
10. NF-27 wire release-please/publish for the package.
11. NF-30/NF-31 plugin: pin apple-targets range, pbxproj fixture test,
    loud infoPlist merge, nightly macOS build.
12. NF-11 async counter path; NF-12 owning-queue timers.
13. §2.4 Tier 1 modifiers + a11y completion (starts the design system).

**P2 — decided-by-measurement / product**
14. §2.3 commit protocol v2 (patches) — only when the NF-20/on-device
    number says so.
15. §2.4 Tier 2 tokens/variants + animation fields.
16. NF-13 BLE base64; NF-17 timeline currentIndex; NF-32/NF-33/NF-35 OTA
    hardening trio; remaining minors.
17. Engine/framework swaps: **no action** — triggers documented in §2.1/§2.2
    (Hermes-gains-watchOS-target; measured post-compiler JS cost or bundle
    floor for Solid; Moddable relicense for XS).

**Explicit non-recommendations** (so the next reviewer doesn't reopen
them without new evidence): SolidJS rewrite now (do the protocol seam
first, §2.2); XS/Moddable ever, absent relicensing (§2.1); tree-diff
protocol *before* an interpreter-engine measurement (NF-20, Rule 2);
Tamagui-class styling infra (§2.4); making the macOS build a PR gate
(CX-013 stands — nightly + fixtures instead, NF-30).

## Sources (landscape refresh, 2026-07-01)

- Moddable licensing: <https://www.moddable.com/license>,
  <https://github.com/Moddable-OpenSource/moddable>
- Hermes V1 default in RN 0.84:
  <https://reactnative.dev/blog/2026/02/11/react-native-0.84>; Static
  Hermes status via <https://romanliutikov.com/blog/native-apps-with-clojurescript-react-and-static-hermes>
- quickjs-ng: <https://github.com/quickjs-ng/quickjs/releases>; Bellard
  upstream 2025-09: <https://bellard.org/quickjs/>
- SolidJS universal renderer:
  <https://github.com/solidjs/solid/tree/main/packages/solid/universal>,
  <https://www.thisdot.co/blog/how-to-create-your-own-custom-renderer-in-solidjs>
- TC39 Signals (Stage 1): <https://github.com/tc39/proposal-signals>
