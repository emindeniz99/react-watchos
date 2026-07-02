# Self-review cycles — capability + render-pipeline + core (2026-07-02)

Four adversarial multi-agent review workflows run against the Swift and JS
surfaces of the framework, most written this session **without a compiler in the
dev container** (no Swift toolchain on Linux; `ReactWatchHost` — the SwiftUI host —
compiles only on the macOS `react-native-watchos swift build` workflow). Each
workflow fanned reviewers across dimensions, then **independently verified every
finding with a default-refute skeptic** before it counted. Only verified,
high-confidence findings were fixed.

This doc is the decision log for those cycles. It supersedes nothing in the
merged backlog — it records post-backlog hardening of code added after the
2026-06-27 deep dive (the capability bindings + the design-system/primitive
vocabulary + the audio media capability).

## Why these reviews

The 2026-06-27 deep dive explicitly flagged that the Darwin bridge code
(`BluetoothBridge`, `SensorBridge`, the commit closure, `JSRuntime` threading)
and the async/native-push paths are "unverified by any automated test on any
platform" — they are `#if os(watchOS)` and the Linux `swift test` suite can't
reach them. Everything bound this session (7 capability bridges, 2 SwiftUI
interpreters' new vocabulary, the audio bridge) lives in exactly that
unreachable region. Static adversarial review is the only verification available
here short of the macOS CI build; these cycles are that review.

## Cycle 1 — capability code (commit `93f6d65`)

Dimensions: Swift-6 strict concurrency, Apple-API correctness (docs-verified),
invoke settlement/generation-guard lifecycle, JS↔native contract, resource
lifecycle. **9 confirmed of 9**, all fixed:

- **CRITICAL** — `AudioBridge.play()` captured the non-Sendable `self` and
  `settle` inside the `@Sendable` `URLSession` completion → the watchOS target
  would not compile under Swift 6. Laundered both with `nonisolated(unsafe)`,
  confined to the main queue.
- **HIGH** — `scheduleBackgroundRefresh` was the sole async settle missing the
  `gen == self.generation` guard → a torn-down runtime could mis-settle a reused
  invoke id.
- **HIGH ×2** — `boot()` never stopped audio / speech / extended-runtime, leaking
  a looping player + active `AVAudioSession`, an in-flight utterance, and a
  battery-sensitive `WKExtendedRuntimeSession` across a reload/OTA-apply. Stop
  all three; a `silent:` flag suppresses the teardown-only lifecycle event so it
  can't misroute into the fresh runtime.
- **MEDIUM** — `playAudio` rejected with an ad-hoc `"AUDIO_FAILED"` code outside
  the closed `InvokeErrorCode` set → emit `INTERNAL`.
- **MEDIUM** — Keychain items used `WhenUnlocked`, so background/locked reads
  failed and read back as "absent" → `AfterFirstUnlockThisDeviceOnly`.
- **MEDIUM** — `enableWaterLock` was routed in Swift + exported in JS but absent
  from the schema/wire table; the routing drift test was one-directional so it
  went uncaught. Added to the schema; **made the routing test bidirectional**
  (scoped to the `handleInvoke` dispatcher).

## Cycle 2 — render pipeline (commit `efd1d77`)

Dimensions: watch-interpreter primitives, watch↔widget parity, style/modifier
parsing, serializer/reconciler. **11 confirmed of 11**, all fixed:

- Serializer: `textContent` folded boolean children to the literal
  "true"/"false" (React renders booleans/null/undefined as nothing), breaking the
  idiomatic `{cond && "…"}` guard. Fixed + regression test.
- Watch interpreter: nested rich `<Text>` (depth ≥ 2) dropped its text
  (`textSegment` didn't recurse); the per-node `.animation(nil, value:)` was
  attached to **every** node and shadowed any ancestor's animation across the
  subtree; inverted numeric ranges (`from>through`/`min>max`) **trapped and
  crashed the whole render** in Slider/Stepper/Gauge/CrownRotation.
- Widget parity: NavigationLink's label form rendered blank; NavigationStack
  dumped every route's content instead of the root; Section footer + ProgressView
  label were dropped; Stepper's implicit-range default skewed the read-only
  fraction; TimerText was mislabeled `widget:"full"` though `milliseconds` can't
  live-tick sub-second in WidgetKit (marked `degraded`, documented watch-only).

## Cycle 3 — core (OTA / runtime / reconciler / BLE-sensor)

Dimensions: OTA security + state machine, runtime/invoke lifecycle, reconciler
host config, BLE/sensor bridge lifecycle. **5 confirmed of 5.** The two OTA
findings both defeat NF-35 — the review paid for itself here.

- **CRITICAL** — OTA bytecode trusted via an UNSIGNED field. The signed message
  is `scheme:keyId:version:js`; the on-device-compiled `.qbc` blob's only
  integrity check was `record.bytecodeHash`, an unsigned field an App-Group
  writer also controls. Under enforcement, such a writer could pin the hash to a
  malicious bytecode blob and run arbitrary code despite a valid signature — full
  in-sandbox RCE with signing enforced. Fix: `evaluateOTA` no longer trusts the
  App-Group `.qbc` under `.enforced` — it runs the boot-re-verified source. The
  bytecode fast-path survives off-enforcement (dev) and for the shipped bundle
  (in the signed app bundle, no untrusted writer).
- **HIGH** — Boot re-verify was skipped for `.misconfigured`/`.unconfigured`, so
  `load()` could route an App-Group candidate to `.runOTA` and `evaluateOTA` ran
  it with no signature check — violating CX-003's fail-closed guarantee and
  re-opening NF-35 when key config is broken/absent. Fix: `load()` fails those
  states closed to the shipped bundle (keeping the candidate, so fixing a key
  typo recovers it).
- **HIGH** — `appendChild` corrupted the tree on a keyed reorder-to-last:
  react-reconciler reuses `appendChild` (no preceding `removeChild`) to move a
  child to the last slot, and the plain `push` duplicated it (duplicate wire
  ids). Fix: remove-then-append (move semantics), mirroring `insertInto`.
  Regression test added.
- **MEDIUM** — Heart-rate authorization completion started an orphaned
  `HKWorkoutSession` after a stop/unmount/reload during the async auth window
  (battery + stale events). Fix: a `wantHeartRate` desired-state latch gates the
  completion; `beginWorkout` is now idempotent.

### Deferred (tracked): HIGH — widget OTA runs unverified

`WidgetIntentRuntime.loadBundle` executes the known-good OTA record/bytecode
from the App Group with **no Ed25519 re-verification** (the app re-verifies; the
widget doesn't). Under the NF-35 writable-App-Group model, an attacker who
overwrites `knownGoodRecord`/`knownGoodBytecode` gets code execution in the
widget process on the next timeline refresh.

Not fixed in this batch because the correct fix is cross-cutting and shouldn't be
rushed blind: the widget must obtain the trusted keys from a location an
App-Group writer can't forge — i.e. **baked into the code-signed widget extension
bundle** (Info.plist entry written by the config plugin, or a compiled constant),
NOT read from the App Group. That needs (a) a signature verifier factored into
the shared `ReactWatchSupport` (today it lives only in `ReactWatchHost`), (b)
`WidgetIntentRuntime` reading the pinned keys + re-verifying `knownGoodRecord`
before eval, falling back to the shipped bundle on failure, and (c) the config
plugin / scaffold writing the keys into the widget target. This is the **top open
security item** and should land with a compiler in the loop (macOS build).

## Cycle 4 — JS integration seams (fetch / connectivity / notifications / widgets / storage / intents)

Dimensions: fetch/network, connectivity+notifications, widgets/storage/intents.
**5 confirmed of 6.** Unlike the Swift cycles these are pure JS, so every fix
ships with a Linux-runnable regression test.

- **HIGH** — `fetch()` hung forever + leaked its pending entry when `__host.fetch`
  is absent (reduced/widget/test host): the native call was an optional-chained
  no-op that never settled. Now rejects (CX-022 fail-loud), mirroring invoke's
  UNAVAILABLE guard, before allocating any state. Test added.
- **MEDIUM** — `invoke()` armed the 30s timeout timer + pending entry BEFORE
  `JSON.stringify(payload)`, so a non-serializable payload (BigInt / circular
  ref) rejected but orphaned the timer+entry for 30s each — a per-call leak.
  Serialize up-front; reject `INVALID_REQUEST` before arming anything. Fixes it
  for every invoke caller (sendToPhone, etc.). Test added.
- **MEDIUM** — the inspector's `console.log` tee ran `String(arg)` (which throws
  on a null-prototype object / throwing `toString`) BEFORE the real log, so a
  benign `console.log` could throw into the caller. Now logs first, captures
  defensively.
- **MEDIUM** — one widget's `render()`/`instances()` throwing aborted publishing
  ALL widgets (healthy complications silently dropped; via the intent
  auto-reload path a buffered mutation left unpublished). Per-kind try/catch
  isolates them, matching the native-event dispatcher's per-listener isolation.
  Test added.
- **LOW** — fetch `settle()` tore down a caller-shared `AbortSignal.timeout`
  timer, dropping the timeout for other in-flight fetches sharing that signal.
  An `ownsTimer` flag limits teardown to the internal `timeout:` sugar signal.

## Cycle 5 — Expo config plugin + scaffold (the consumer install path)

Dimensions: pbxproj/target wiring, package-resolution/Info.plist merge, scaffold
generators. **3 confirmed of 3** — notably all medium/low, the signal that review
is converging. All pure JS/Node, each fix verified with a test.

- **MEDIUM** — the plugin calls `plist.parse/build` (Info.plist merge) but
  `plist` was an **undeclared dependency**, reached only as a
  transitive-of-transitive of `@expo/config-plugins`. Default installs hoist it
  so it works, but a strict layout (pnpm `hoist=false`) or peer-version drift
  makes `expo prebuild` fail with `MODULE_NOT_FOUND` mid-merge. Declared `plist`
  as a direct dependency (lockfile updated).
- **LOW** — `withEasAppExtensions` concatenated the bundle suffix unconditionally
  while apple-targets only appends a *leading-dot* suffix (else uses it verbatim).
  A non-dot `watchBundleSuffix` override produced a duplicate EAS entry + a
  non-namespaced bundle id. Now shares apple-targets' dot-aware derivation. Test.
- **LOW** — a target `name` whose identifier head is a digit ("2 Watch") produced
  an invalid Swift `@main` struct name. `identifierBase` now prefixes a non-digit.
  Test.

## Coverage gaps (honest limits)

- **The Swift was never compiled.** Cycles 1–3 are static reasoning over source +
  Apple-docs JSON. The critical Swift-6 finding in Cycle 1 proves the value (a
  real compile break caught), but the corollary is that other type/isolation
  errors could remain until the macOS `react-native-watchos swift build`
  workflow actually compiles `ReactWatchHost`. That build is the outstanding
  gate for every "② pending" row in `status.md`.
- No device/simulator execution: animation shadowing, the range-trap crashes, and
  the audio/session teardown are reasoned, not observed firing.
- The verifier default-refutes, which biases toward false negatives (a real
  defect it couldn't confirm is dropped) over false positives — so "0 remaining"
  in a dimension means "none survived verification," not "provably none."
