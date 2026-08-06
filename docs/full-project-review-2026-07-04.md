# Full project review — 2026-07-04 (all dimensions, production readiness)

The owner asked: *is this a production-ready library yet — across requirements,
design, architecture, code, DX, everything? What's missing, what should change,
what's the roadmap?* This document is the answer, and the complete note of every
point found.

**Method.** Eight independent deep-review passes, one per dimension
(requirements/product, architecture, JS code, Swift code, security, DX/packaging,
testing/CI, release readiness), each with full repo access. Every finding rated
blocker/major was then **adversarially verified** by an independent skeptic pass
instructed to refute it against the actual code; only findings that survived are
listed as CONFIRMED. 56 raw findings → **25 confirmed (4 blockers, 19 majors,
2 majors downgraded to minor), 27 unverified minors, 4 refuted** (listed in the
appendix so they aren't re-found later). Two headline facts (npm name ownership,
zero release tags) were additionally re-verified by hand. Limits of this review:
Linux environment — no Swift compile, no simulator, no device; Swift findings
are static-analysis reads.

---

## 0. Resolution status — updated 2026-07-06

> This review was written on a **Linux box with no Swift compile, no simulator,
> no device** (see the Method note). Since then the blockers and majors have
> been worked through and verified **locally on macOS** (the owner's chosen gate
> — GitHub Actions stays dormant by decision, so B1 below is "verified locally"
> not "green on the runner"). The table is the reconciliation; the body of the
> review is kept verbatim as the historical record.
>
> **Local Mac gates, all green 2026-07-06:** `pnpm test` 382 ✓ · `swift test`
> 199 ✓ (compiles clean under `swift-tools-version:6.0`) · watchOS app build +
> on-sim run green (`pnpm run:watch`, Ultra 3) · `typecheck` · `lint` · `check:size` ✓.

| # | Item | Status | Evidence |
|---|------|--------|----------|
| **B1** | CI pipeline dark | **Resolved locally** | Owner decision: verify on macOS, not GitHub Actions. All gates pass locally (above). GitHub `build.yml` stays `workflow_dispatch` by choice; the runner badge is deferred, not the verification. |
| **B2** | npm name taken | **Resolved** | Publishing identity decided → `react-watchos` (CLAUDE.md naming note). Folder/scope stay `react-native-watchos`. |
| **B3** | widget NSLock deadlock | **Resolved** | `WidgetIntentRuntime.renderFreshTimelines` now constructs + evaluates the runtime **outside** `cacheLock`, reconciled by a `cacheEpoch` snapshot (`WidgetIntentRuntime.swift:286–316`, B3-annotated). |
| **B4** | Swift 6 concurrency | **Resolved** | Package compiles clean under Swift 6 and `swift test` runs 199 tests green; the watchOS app builds. The `MainActor.assumeIsolated` / `Task { @MainActor }` pattern is applied at the flagged sites. |
| M1 | widget timers off-thread | **Resolved** | `JSRuntime` owning-queue confinement + timers refused in intent-mode widget JS. |
| M2 | sync invoke re-entrancy | **Resolved** | `drainJobs` is depth-aware — microtasks drain only at the outermost host entry. |
| M3 | `Double→Int` traps | **Resolved** | One clamping helper for every wire-number→Int; adversarial magnitude tests. |
| M4 | widget Gauge reversed bounds | **Resolved** | Bounds normalization shared so the interpreters can't drift; reversed-bounds parity test. |
| M5 | OTA boot sequencer untestable | **Resolved** | `OTABootSequencer` extracted into Linux-tested `ReactWatchSupport`. |
| M6 | two interpreters, case-only parity | **Partial (not a blocker)** | Per-prop **golden parity gate** shipped (M6-interim) + ARCH-10 **Phase A** shared helpers. Full single-interpreter consolidation (Phase B) is a deferred quality item. |
| M7 | no i18n/locale story | **Resolved** | `locale/language/is24Hour` in `getDeviceInfo`; `Intl` gap documented; translation layer; native `FormattedText`; CLDR plurals via `plurals-cldr`. |
| M8 | README drifted | **Resolved** | README reconciled with status.md. |
| M9 | vendored QuickJS unverified | **Resolved** | Tarball SHA-256 pinned in the vendor script (fails on mismatch). |
| M10 | README quickstart stale | **Resolved** | Native-setup rewritten to the real (generator) flow. |
| M11 | dev loop unshipped | **Resolved** | `dev` / `build` / `inspector` shipped as CLI subcommands. |
| M12 | no API reference | **Resolved** | Generated typedoc API reference + capability tables. |
| M13 | HealthKit entitlement default | **Resolved** | Plugin default flipped to `healthKit: false` (least privilege). |
| M14 | embed-smoke asserts nothing | **Resolved** | Epilogue now throws on `handled !== true` / no count advance. |
| M15 | wire fixtures ~5/39 | **Resolved** | Serializer-generated kitchen-sink fixture (every component + modifier props). |
| M16 | consumer TS builds break | **Resolved** | Source-shipping tsconfig contract documented (required `types:["node"]`). |
| M17 | SECURITY/issue templates | **Resolved** | watchOS added to SECURITY.md scope + a watchos issue template. |
| M18 | no root LICENSE | **Resolved** | MIT LICENSE added at the project root. |

### What's actually still open (the real prod gap)

1. **Real-device verification — first run achieved 2026-07-05, feature depth still pending.**
   The stack now **boots and renders on a physical Apple Watch Ultra 3** (watchOS
   26.5), properly signed against a real team with the App Group provisioned — so
   the review's "zero real-hardware verification" no longer holds. What remains is
   *feature-level* hardware validation: Taptic haptics, Digital Crown feel,
   HealthKit heart-rate + GPS streams, BLE against a real peripheral, StoreKit
   purchases, extended-runtime, OTA crash-loop triggers, battery, and the
   complication on the live watch face. **This depth is the biggest remaining item
   for a device-grade production claim.**
2. **On-device AI — ⛔ blocked externally.** `generateText`/FoundationModels needs
   the **watchOS 27 SDK (Xcode 27)** to compile; unavailable today. Gate is
   corrected; nothing to do until the SDK ships.
3. **First publish never rehearsed.** Name is decided (`react-watchos`) but zero
   release tags exist; the `release-please` publish dry-run + a real tag are still
   pending. *(Partly superseded by the 2026-07-06 addendum below: a private
   end-to-end Verdaccio publish + fresh-project install passed. The real
   registry publish/tag is what remains.)*
4. **M6 Phase B** (collapse the two SwiftUI interpreters into one) — deferred
   quality/maintenance work, not shipping-blocking.

The two "deferred minors" from the 07-02 self-review are **both resolved in code**
(verified 2026-07-06): the uncontrolled `NavigationStack` path is tracked in
`navigation.tsx` (`localPath`) and reported natively (`RoutedNavigationStack`'s
uncontrolled `else` branch dispatches `pathChange`); the root-route a11y is
applied in **both** interpreters (`NodeView.RoutedNavigationStack` and
`ReactWidgetView.navigationStackRoot`).

### Verified consumer packaging (2026-07-06)
`npm pack` → install the tarball into a fresh consumer → `tsc --noEmit` exits 0
(after fixing the `Timeout`/`number` casts and shipping the transitive
`@types`). A private end-to-end publish rehearsal also passed: published
`react-watchos@0.1.0-alpha.0` (`--tag next`) to a local Verdaccio registry and
`npm install react-watchos@next` pulled it into a fresh project cleanly. Secret
scan (`gitleaks`, config committed) is clean — no first-party secrets.

### 2026-07-16 addendum — the §7 "near term" capability rows shipped

The §7 near-term list is now in code (see the merged backlog's build-progress
log for evidence): **WatchConnectivity background channels** (ARCH-12 —
`updateApplicationContext`/`transferUserInfo` outbound over invoke, inbound
split into `onApplicationContext`/`onUserInfo`); the **BLE reliability pair**
(`withResponse` acked writes + bounded auto-reconnect; `bleConnect`/`bleWrite`/
`bleSubscribe` settle as promises — CX-022 complete in code, real-peripheral
verification still owed); **controlled TabView `selection`/`onChange`** with the
CX-010 read-only rule; and the **range-prop unification on `min`/`max`**
(breaking, pre-release). The same burst landed ARCH-09 lazy confirmed navigation
(launch tree 152→48 nodes, ~0.52 ms/dispatch on the vendored-engine bench),
ARCH-13 structured diagnostics + operating budgets, and the 2026-07-08
perf/battery audit's fix set — and the SwiftPM package now compiles and
`swift test`s on **Linux** (227 green). GitHub Actions remains disabled by the
B1 decision; all of this is locally verified.

**Bottom line:** the 4 blockers and 18 majors from this review are closed
(M6 partial by design); what remains is a **real-hardware pass** plus the
**publish rehearsal**, not code debt. The verdict moved from "pre-launch, dark
pipeline" to "verified on macOS + simulator; needs a device pass before
device-grade claims."

---

## 1. Executive summary

**Is it production-ready today? No — but it is unusually close for a 0.x, and
the path to "yes" is short, enumerable, and mostly operational rather than
architectural.**

The engineering core is genuinely strong. Every dimension scored 6–8/10; the
review found **no architectural dead end and no fundamental design mistake**.
The four-pillar promise (React 19 + hooks inside QuickJS *on the watch* driving
native SwiftUI; standalone; Ed25519-signed OTA with refusal-by-default;
React-authored complications with in-extension intents) is genuinely
implemented, the wire/engine/interpreter seams are real, the OTA trust chain is
carefully layered, and the claims discipline (status.md evidence ladder, gated
launch checklist) is better than most 1.0 projects.

What stands between here and production is concentrated in four blockers:

| # | Blocker | Dimension | One-line |
|---|---------|-----------|----------|
| B1 | **CI has never run green — the pipeline is dark** | testing-ci | Linux CI: 2 runs ever, both `startup_failure` (2026-06-25). macOS build: **0 runs ever** (the nightly has never fired). release-please: 3 runs, all failures. Automatic runs appear disabled at the repo level. Every documented gate currently gates nothing. |
| B2 | **npm name `react-native-watchos` is already owned by someone else** | prod-readiness | Verified: registry has a 0.0.0 placeholder registered by another maintainer since 2023-06. The configured release pipeline cannot publish under the current identity. |
| B3 | **Deterministic same-thread NSLock deadlock in the widget runtime** | swift-code | `WidgetIntentRuntime.renderFreshTimelines` holds `cacheLock` across bundle evaluation; a bundle that calls `publishWidgets()` during load re-enters `invalidateCache` → permanent hang → extension watchdog-killed, complications stop updating. |
| B4 | **Swift 6 strict-concurrency violations that will fail the E2 compile** | swift-code | ~7 sites in `ReactWatchModel` where `DispatchQueue.main.async` (`@Sendable`) closures touch `@MainActor` state directly. `swift-tools-version:6.0` makes these hard errors. The first macOS build will be red until they're wrapped (`MainActor.assumeIsolated` — the codebase already uses the right pattern elsewhere). |

B1 changes the meaning of everything else: the repo *believes* it has drift
checks, size budgets, contract tests, and a nightly compile gate — GitHub says
none of it has ever run. **Re-enabling Actions and getting one green run of both
workflows is the single highest-leverage action available.** It is also the
review's most important discovery, because several project docs (and prior
review sessions) assumed "Linux CI green on every push" — that assumption is
false today.

**Honest overall verdict:** a well-built, well-documented, security-serious
framework in a **pre-launch state with a dark pipeline**. Fix B3/B4 in code
(hours), fix B1/B2 operationally (a setting + a naming decision), get E2 green,
run the publish rehearsal — then this is announceable with simulator-grade
claims, exactly as the launch checklist already envisions.

## 2. Scorecard

| Dimension | Score | Prod-ready? | One-line verdict |
|---|---|---|---|
| Requirements & product | 8/10 | with-caveats | Promise delivered, scope watch-shaped; README drifted from status.md; i18n silently absent |
| Architecture & design | 8/10 | with-caveats | Real seams, closed-loop protocol, measurement-driven; widget threading + sync re-entrancy are the two live design risks |
| JS/TS code | 8/10 | with-caveats | Disciplined bridge code; both headline "bugs" were refuted; remaining items are narrow contract gaps |
| Swift code | 6/10 | **no** | High discipline, but B3 deadlock + B4 compile-breakers + two trap families on wire numbers |
| Security | 7/10 | with-caveats | Signature chain genuinely solid; residual risk sits *around* it (supply chain, revocation speed, observability) |
| DX & packaging | 7/10 | with-caveats | Examples/exports/plugin verified working; docs drift + unshipped dev loop + entitlement default |
| Testing & CI | 6/10 | **no** | Exceptional tests, dark pipeline (B1); engine-behavior assertion gap |
| Release readiness | 6/10 | **no** | Release engineering well-designed; name collision (B2) + missing OSS table stakes |

Cross-dimension pattern: **the weakest scores are operational, not
architectural.** Nothing here says "redesign"; everything says "wire it up,
verify it, publish it honestly."

## 3. Confirmed findings — the complete list

Ordered by severity, then blast radius. Every item below survived adversarial
verification. (Unverified minors are listed in §5 per dimension.)

### Blockers

**B1 — CI pipeline has never successfully run** (`.github/workflows/react-native-watchos-ci.yml`)
Verified via the Actions API: `react-native-watchos-ci.yml` — 2 runs, both
2026-06-25, both `startup_failure` (a repo-level failure class: Actions
disabled/billing/permissions, not a job bug). `react-native-watchos-build.yml`
(macOS compile + watchOS-simulator tests, nightly cron) — **zero runs ever**.
`release-please.yml` — 3 runs, all failures. Commits continued July 1–3 with no
runs triggered. Consequence: codegen drift check, fixture drift check, size
budget, vitest + qjs smoke, C-embed smoke, bytecode gate, examples gate, and the
Swift wire tests currently protect nothing.
*Fix:* re-enable Actions automatic runs (or resolve the account-level cause),
get one green run of both workflows, make the js + swift-package jobs required
PR checks, and add a failure notification for the nightly so a silent scheduler
outage is noticed (this one wasn't).

**B2 — npm name is taken** (`js/package.json`)
`npm view react-native-watchos`: version 0.0.0, registered by another
maintainer, created 2023-06-11. The whole release identity hangs on this
string: package name + bin, `release-please-config.json` package-name, the
publish job filter, plugin `require.resolve` self-references, both READMEs,
examples' deps, announcement copy.
*Fix:* decide now — scope it (`@emindeniz99/react-native-watchos`) or request
transfer of the placeholder (a 0.0.0-placeholder transfer request is routine).
Then grep-replace the identity across
the eight touchpoints and re-run the pack dry-run. Also weigh the finding below
(§5 requirements, minor) that the `react-native-*` prefix itself makes the one
claim the checklist forbids ("not React Native core") — if a rename is happening
anyway, `react-watchos` matches the internal naming (`ReactWatch*` modules,
`reactwatch://` scheme).

**B3 — widget runtime same-thread deadlock** (`js/swift/Sources/ReactWatchWidget/WidgetIntentRuntime.swift:240–271`)
`renderFreshTimelines` takes the non-reentrant `NSLock cacheLock`, then
constructs `WidgetIntentRuntime` *inside* the lock; `init` evaluates the whole
bundle; the `publishWidgets` bridge closure (installed before evaluation) calls
`invalidateCache()`, which takes `cacheLock` again on the same thread —
documented permanent hang, extension watchdog-killed, complications frozen. The
JS-side `renderingWidgets` guard does not cover bundle-load-time publishes, and
the documented post-OTA flow makes exactly such a publish plausible.
*Fix:* never hold the lock across runtime construction/evaluation — build and
render outside, swap the cached payload under the lock (accept a rare duplicate
render); and/or defer wiring the `publishWidgets` closure until after `loadBundle`.

**B4 — Swift 6 concurrency violations at ~7 sites** (`js/swift/Sources/ReactWatchHost/ReactWatchHost.swift`)
`ReactWatchModel` is `@MainActor`; `DispatchQueue.main.async` closures are
`@Sendable` in the Dispatch overlay (the project's own `PhoneConnectivity.swift`
comment acknowledges this), yet at ~7 sites they read/mutate MainActor state
directly (`requestNotificationPermission`, `sendToPhone`, the commit decode hop,
`js.onError`, `scheduleNotification`, others). Under `swift-tools-version:6.0`
these are compile errors — the E2 gate will be red on first run.
*Fix:* wrap each body in `MainActor.assumeIsolated` (pattern already used at
ReactWatchHost.swift:1479) or switch to `Task { @MainActor in … }`. Then run the
macOS compile *before* merge rather than after.

### Majors — runtime correctness (Swift/architecture)

**M1 — widget timers violate the QuickJS single-thread contract**
(`JSRuntime.swift:412–422` + `ReactTimeline.swift:193–207`, found independently
by both the architecture and Swift passes). `scheduleTimer` always delivers
`__fireTimer` on `DispatchQueue.main`, but widget runtimes are created,
evaluated, and deinited on WidgetKit provider/intent threads. Any timer armed
while widget JS runs (reconciler timeout hop, invoke watchdog — `hostInvoke` IS
installed in the widget) fires on the wrong thread against a possibly-freed
context. Also the confinement assertion covers only app-path entry points, not
`evaluate*`/`callReturning*`.
*Fix:* give `JSRuntime` an owning serial queue captured at init (app = main;
widget = its own), route timers and all entries through it, and generalize the
DEBUG assertion from "main thread" to "owning queue". Interim: make `setTimer` a
loud no-op in the `.widget` target and document that intent-mode JS has no timers.

**M2 — synchronous invoke settles re-enter the JS job queue mid-frame**
(`ReactWatchHost.swift:290–364` + `JSRuntime.swift:330–343`). Handlers that
settle inline on the `hostInvoke` C-trampoline stack (`getDeviceInfo`,
keychain, speak, waterlock, extended-runtime, `saveUpdate`…) call
`resolveInvoke → bridgeCall → callGlobalReturning`, which ends in `drainJobs` —
executing queued microtasks (including React scheduling) while the outer JS
statement is still suspended. Breaks run-to-completion assumptions; a subtle
re-entrancy bug class.
*Fix:* one main-queue hop for inline settles (matching every async handler), or
make `drainJobs` depth-aware (host-entry counter; only drain at outermost exit —
fixes the whole class once).

**M3 — trapping `Double→Int` conversions on wire-controlled numbers**
(`RNStyle.swift:66–79` + both interpreters). `Int(1e300)` traps. Four reachable
sites: Gauge's `formatValue` (both interpreters — `max=1e300` clamps value to
1e300 then traps), millisecond `TimerText` with far-future `until` (traps every
TimelineView tick), Picker index. A plain JS prop bug crashes the native app or
widget.
*Fix:* one clamping helper for every wire-number→Int conversion; adversarial
magnitude cases (±1e300, ±2^63) in RNStyleTests + parity tests.

**M4 — widget Gauge traps on reversed bounds — interpreter drift**
(`ReactWidgetView.swift:329–332`). The app interpreter explicitly normalizes
reversed `min/max` ("so a reversed min/max can't trap", NodeView.swift:484–488);
the widget builds `min...max` raw — same wire tree renders in-app, crashes the
extension.
*Fix:* copy the normalization; better, move bounds normalization into shared
`RNStyle` so the two interpreters *cannot* drift on it; add a reversed-bounds
Linux parity test.

**M5 — OTA boot orchestration lives in the least-testable target and runs on
the main thread** (`ReactWatchHost.swift:788–923, 976–1003`). The pure decisions
are commendably extracted to Linux-tested `ReactWatchSupport`, but the
*sequencing* (decision/re-decision flow, high-water bump ordering, boot-attempt
counting, known-good promote/restore, record+bytecode pairing) sits in the
`@MainActor` SwiftUI target with zero unit tests — precisely where
anti-rollback/crash-loop bugs live (doc history shows multiple fixed there,
including one found by PR bots this week). Validator eval + bytecode compile
also run synchronously on main at boot.
*Fix:* extract an `OTABootSequencer` into `ReactWatchSupport` with injected
file-IO and runtime-factory seams; move validator/compile off main; return a
typed result from `saveUpdate` instead of round-tripping through the
`@Published runtimeError` UI property (see minor list).

**M6 — two hand-maintained SwiftUI interpreters: parity enforced only at case
granularity** (`ReactWidgetView.swift` vs `NodeView.swift`). Shared parsing
(RNStyle) and the case-presence contract test are real mitigations, but
per-prop behavior inside each case is parity-by-comment (`applyLayout` chain,
systemColor tables, alignment mappers, chart builders are verbatim duplicates).
M4 is this liability made concrete. Compounds directly against the roadmap's
multi-platform bet.
*Fix:* execute the already-designed ARCH-10 shape (one NodeView parameterized by
a RenderContext; widget degradations as else-branches) before any second
platform target; until then, a schema-generated per-prop golden parity test.

### Majors — product/requirements

**M7 — no i18n/locale story anywhere, and the gap is unacknowledged**
(`js/src/device.ts` + vendored engine). QuickJS ships no `Intl`;
`toLocaleString` renders a hardcoded US format; the host never exposes
locale/language/24-hour; no non-vendored Swift references `Locale`. An app
cannot format dates/numbers per-locale **or even pick a translation table**.
Watch UIs are dominated by exactly this content. Every other cut (Suspense, AI,
eager mounting) is documented — this one appears nowhere in README limitations,
roadmap, or status.md.
*Fix:* add `locale/language/is24Hour` to `getDeviceInfo` (one payload change);
document the `Intl` absence in README Limitations; consider a native-formatted
date/number primitive (the TimerText "hand native the declarative target"
philosophy); name i18n as a roadmap track.

**M8 — README has drifted from the status.md authority in both directions**
(`README.md:43–49, 447–449, 456, 508`). It advertises Keychain/TTS/background
refresh/extended runtime/IAP/device info unqualified under a "compiles and runs
on the simulator" claim — status.md marks exactly those ①→② pending (never yet
watch-compiled). Meanwhile it *omits* shipped fetch/sensors/BLE entirely, lists
WatchConnectivity as "Future" (both sides shipped), names 31/39 primitives, and
quotes stale numbers (~174 KB vs the checklist's re-verified 177 KB).
*Fix:* before first publish, reconcile README against status.md (scope the
simulator claim to ②/③ rows; add the missing shipped features; fix stale
numbers). Consider generating the capability list from the same schema that
feeds codegen so it can't drift again.

### Majors — security

**M9 — vendored QuickJS (the entire trust base) is re-vendored with zero
integrity verification** (`tools/vendor-quickjs/run.sh`). `curl | tar` with no
pinned SHA-256, no signature check, no CI job comparing the vendored C against a
committed checksum manifest. The engine runs 100% of app JS including every
signed OTA bundle — a compromised release asset or MITM grafts attacker C into
the trust base silently.
*Fix:* pin the tarball SHA-256 in the vendor script (fail on mismatch); commit a
per-file checksum manifest; add a CI job that recomputes and compares.

*(Adjusted to minor by verification, noted here for completeness: no fast
key/bundle revocation — a leaked signing key stays valid fleet-wide until an App
Store release drops the kid. Recommended anyway as a near-term hardening: a
signed minimum-acceptable-version / expiry field inside `signedMessage` gives a
revocation lever that propagates at OTA speed instead of App-Store speed.)*

### Majors — DX & packaging

**M10 — the root README quickstart describes a stale integration the shipped
plugin will fight** (`README.md:305–309`). It says to add the plugin "after
apple-targets" and to hand-write `expo-target.config.js` — but the plugin
composes apple-targets internally and *generates* (and gitignores) the target
config; the example's app.json shows the real flow. A consumer following the
README collides with the generator.
*Fix:* rewrite "Native setup" to match the example; make
`ensureTargetConfigFile` refuse to overwrite a non-generated file with guidance
instead.

**M11 — the flagship dev loop (hot restart + inspector) is demo-only: not
shipped, not documented** (`js/package.json` files list). Every consumer DEBUG
build polls `127.0.0.1:8788/bundle.js` (hardcoded), but `scripts/dev.mjs` and
`scripts/inspector.mjs` are not in the npm tarball, not bin subcommands, and
appear in no consumer doc. `startInspector` is a public export whose server a
registry consumer cannot obtain.
*Fix:* ship `react-native-watchos dev` / `build` (and `inspector`) bin
subcommands wrapping the preset + serve loop; document the DEBUG polling
contract; make the poll URL configurable (needed for device hot-reload later
anyway).

**M12 — no API reference; a large slice of the public surface appears in no
consumer document** (~110 value exports + ~80 types; zero docs found for
Slider/Stepper/DatePicker/Map/CrownRotation/SwipeAction/ErrorBoundary/sensors/
defineMessages/startInspector; README lists 31/39 primitives).
*Fix:* generate `docs/api.md` from the already-good TS types/JSDoc (typedoc);
complete the README vocabulary; emit the capability table from the codegen
schema so it can't drift.

**M13 — plugin defaults every consumer into the HealthKit entitlement**
(`js/plugin/index.js:73`). `healthKit: true` by default adds the entitlement +
usage strings + EAS appExtensions entry for everyone; the project's own example
opts out (`healthKit: false`) — evidence the default is wrong. Consequences:
provisioning failures on App IDs without the capability; App Review scrutiny for
an unused sensitive entitlement. Plugin options also have no accurate consumer
reference table.
*Fix:* flip the default to false (least privilege); add a generated
plugin-options table to js/README; apply the same scrutiny to `widget: true`.

### Majors — testing & release

**M14 — the only run of the production bundle inside the real vendored engine
asserts nothing** (`tools/embed-smoke/embed-host.c`). The epilogue prints
handled/count results; main() exits 0 unless evaluation throws; nothing inspects
the JSON. The behaviorally-asserted `qjs-smoke` suite runs Ubuntu's `qjs` —
**Bellard's QuickJS, not the vendored quickjs-ng that ships**. An ng-specific
behavioral regression passes the whole pipeline.
*Fix:* three lines — make the epilogue throw when `handled !== true` or the
count doesn't advance. Longer-term: build the ng CLI from vendored sources in CI
and point the behavioral suite at it.

**M15 — cross-language wire fixtures cover ~5 of 39 node types and none of the
modifier props** (`js/test/contract-fixture.test.tsx`). The surfaces where JS
and Swift actually meet (padding/frame/animation objects, Grid/Chart/Toolbar/
presentations/rich text) are tested on each side independently with hand-built
literals — nothing mechanically binds them; both sides can drift with green
tests.
*Fix:* one serializer-generated kitchen-sink fixture covering every component +
every modifier prop, decoded and spot-parsed by Swift — upgrades the existing
fixture-drift CI step into a full-surface contract gate.

**M16 — consumer TypeScript builds break out of the box** (source-shipping
package). Reproduced: a strict consumer tsconfig without `"types": ["node"]`
gets 25+ hard errors *inside the package* (`setTimeout`, `process`, `console`
TS2304/2580) because shipped raw `.ts` is type-checked as program files
(`skipLibCheck` doesn't apply). Both in-repo examples mask it by including
@types/node.
*Fix:* either ship compiled JS + `.d.ts`, or make the source-shipping contract
explicit (document required consumer tsconfig; optional @types/node peer) and
add a CI job type-checking a fixture consumer with representative tsconfigs.

**M17 — SECURITY.md and issue templates cover only the flatbuffers projects**
(repo `.github/`). A security-forward OTA library whose announcement pre-answers
"OTA = RCE?" has no security-reporting scope; the required bug-report form asks
for "a minimal .fbs input". `blank_issues_enabled: false` means a watch adopter
literally cannot file a sensible issue.
*Fix:* add react-native-watchos to SECURITY.md scope + supported versions (with
OTA-specific in-scope examples, link the threat model); add a watchos bug/feature
template (package version, watchOS/Xcode, simulator vs device, minimal JSX repro).

**M18 — no LICENSE at repo root or project root** — MIT exists only inside
`js/` (correct for the tarball). GitHub license detection keys off the root;
everything a consumer copies from `examples/`, `app/`, `tools/`, `docs/` carries
no explicit grant. Every flatbuffers sibling has a per-project LICENSE — this
project is the outlier. Checklist R5 marks LICENSE ✅; only the npm half is true.
*Fix:* add MIT LICENSE at `projects/react-native-watchos/` and a root-level
licensing note (or root LICENSE) for the monorepo.

## 4. Refuted claims (reviewed and rejected — do not re-find)

Kept so future reviews don't rediscover them:

1. **"utf8ToBytes mis-encodes astral-plane characters (0x3f mask)"** — false;
   the code already uses the correct `0x3ff` mask (`fetch.ts:186`), verified
   empirically and against git history.
2. **"`process.env.BUNDLE_VERSION` read is DOA under non-esbuild bundlers"** —
   line-level reading accurate, but already adjudicated: a prior review flagged
   it, the fix was deliberately placed in the build preset (the supported
   bundling path), and the hazard is documented there. A `typeof` guard would
   still be a harmless one-line hardening, but it is a recorded decision, not a
   live bug.
3. **"Phone↔watch sync lacks queued/background transfer (updateApplicationContext/transferUserInfo)"**
   — the capability gap is real but was consciously decided (an earlier build
   silently fell back to `updateApplicationContext`; the reconciled backlog
   removed it in favor of explicit reachable-only semantics). Re-proposed in the
   roadmap (§6) as a feature, not a defect.
4. **"Anti-rollback high-water mark is unauthenticated in the App Group — the
   named adversary can force a signed-old downgrade"** — technically accurate
   observations, but the threat model's App-Group-writer adversary is scoped to
   *code execution* protection; version-floor tampering by that adversary was
   judged out of the declared scope. Kept visible in the roadmap as a
   defense-in-depth hardening (sign/HMAC the floor), not a confirmed hole.

## 5. Per-dimension detail (verdicts, strengths, remaining minors)

### 5.1 Requirements & product — 8/10, with-caveats
**Verdict:** the four-pillar promise is genuinely implemented and the v1 scope
is precisely watch-shaped (TimerText native delegation, seq-ack controlled
inputs, complication-first widgets, HKWorkoutSession-backed sensors). Claims
discipline is best-in-class. Gaps: README drift (M8), i18n (M7); everything is
simulator-grade until E3, which the launch process itself gates honestly.
**Standout strengths:** falsifiable evidence ladder (status.md ①②③⛔ with
per-row links); coherent controlled-component API contract across all stateful
primitives; positioning homework (expo-widgets-comparison, prior-art) honest and
thorough; real consumer validation (ctrl-a-remote P0 asks all closed).
**Minors (unverified):** status.md/roadmap self-contradict on iPhone-side
WatchConnectivity (stale in the *under*-claim direction); the npm name asserts
RN-ecosystem membership the docs explicitly disclaim (fold into the B2 rename
decision); TabView is the only uncontrollable stateful primitive (no
`selection`/`onChange`) and Gauge (`min/max`) vs Slider/Stepper/Crown
(`from/through`) use two range vocabularies — both free to fix pre-release,
breaking later; the first consumer's two BLE reliability asks (withResponse
writes, auto-reconnect) remain open while "remotes" is a headline category.

### 5.2 Architecture — 8/10, with-caveats
**Verdict:** unusually well-reasoned for pre-1.0: real seams (codegen'd wire
contract; Linux-testable core), a closed-loop sync-commit + seq-ack protocol,
and a full-tree-serialize decision backed by a benchmark on the *shipping*
interpreter. Live risks concentrate at two seams: QuickJS↔Swift threading
(M1) and synchronous settle re-entrancy (M2); plus the two-interpreter liability
(M6) and OTA orchestration placement (M5).
**Standout strengths:** single-source schema generating TS + Swift + C
trampolines + install tables with drift tests; five-layer SwiftPM split keeping
policy logic Foundation-only/Linux-tested; wire-version reject feeding the OTA
crash-loop counter so an incompatible bundle self-heals; two-axis protocol
evolution (tree `v` + bridgeProtocol/features with per-method `since`).
**Minors (unverified):** `__dispatchEvent`'s payload `JSON.parse` sits *outside*
the seq-ack finally boundary (unreachable from the shipped native side today,
but narrows the "always acks" invariant); `saveUpdate` uses the `@Published
runtimeError` UI property as its error out-parameter (layering smell; blocks the
M5 extraction).

### 5.3 JS/TS code — 8/10, with-caveats
**Verdict:** disciplined bridge code — settle-exactly-once maps with watchdogs,
guaranteed seq-acks in nested `finally`, systematic leak-consciousness — and the
test suite targets exactly those races. Both headline candidate bugs were
refuted; the real items are narrow contract gaps.
**Standout strengths:** invoke channel as a model request/response bridge;
commit dedup correct about the subtle seq-advance case; per-item error isolation
(one bad listener/widget can't starve siblings); every capability module
documents its no-host behavior and the choices match semantics.
**Minors (unverified):** `fetch` silently drops `timeout` when `signal` is also
passed; fetch has no last-resort watchdog (invoke=30s, generate=60s, fetch=∞ —
the "never hangs" invariant applied inconsistently); staged-but-not-relaunched
OTA is re-downloaded on every check (freshness compares against the *running*
release only — battery/radio waste); console shim `String(arg)` can throw on
null-prototype objects (the inspector already has `safeString`; the base shim
doesn't); route param encoding (`decodeURIComponent` can throw on malformed
deep links; `href()` never percent-encodes, so `/` or `%` in params breaks
routing — mirror the rule into Swift's RouteMatcher); `Storage.set(k, undefined)`
silently corrupts (JSON.stringify → undefined crosses the typed bridge);
`setInterval(fn, 0)` re-arms with 0ms verbatim (hot-loops the native timer
bridge — clamp to a small floor like browsers' 4ms).

### 5.4 Swift code — 6/10, NO
**Verdict:** high discipline (verified QuickJS value ownership; uniform
generation guards on every async settle; no force-unwraps on wire data; layered
OTA verification) — but B3 + B4 are shippability blockers and M3/M4 are trap
families that survived the project's own dedicated trap-hunt. All fixes are
localized.
**Minors (unverified):** `BluetoothBridge.reject` hand-builds JSON escaping only
double quotes (backslash/newline in a message ⇒ invalid errorJson ⇒ JS parse
error replaces the typed rejection — route through the shared JSONSerialization
helper); `AudioBridge.play` buffers the entire remote file in memory with no
size cap (the fetch pipeline caps at 5 MiB for exactly this reason — a
podcast-sized URL jetsams the app; use downloadTask-to-file or enforce a cap);
controlled NavigationStack's optimistic `pendingPath` is released only by a
path-prop *change*, so a declined navigation (handler keeps state) leaves native
UI permanently diverged from React state (align with the OptimisticStore ack
model).

### 5.5 Security — 7/10, with-caveats
**Verdict:** the core RCE trust chain is genuinely well-built — Ed25519 over
`scheme:keyId:version:js` (kid + version bound into signed bytes), key-id
charset validation on both signer and verifier (injective message), fail-closed
key states, refusal-by-default, boot re-verification with the bytecode cache
untrusted under enforcement, and a clean `js.evaluate` injection surface (every
interpolation is hex/JSON/int/static). Residual risk sits *around* the
signature: supply chain (M9), revocation speed, observability.
**Minors (unverified):** a build shipped with `allowUnsignedUpdates` over a
previously-enforced install runs the pre-existing App-Group record unverified
*and* trusts its unsigned bytecode cache (documented footgun; consider refusing
signed records under `.disabled`); HTTPS is documented-not-enforced and
`fetch`/`playAudio` accept arbitrary URL schemes (http manifest enables the
freeze attack over cleartext; scheme-allowlist as defense-in-depth); OTA
propagation is unobservable — a widget silently stuck on the shipped bundle, or
a frozen manifest, produces no signal (expose applied releaseId/keyId/version
for app *and* widget).

### 5.6 DX & packaging — 7/10, with-caveats
**Verdict:** unusually well-engineered package — this review *ran* both consumer
examples' typecheck/tests/builds green and verified the 682 kB tarball packs
correctly with provenance. The gaps are documentation and productization (M10,
M11, M12, M13), not correctness. A fresh Mac-owning React dev can plausibly ship
this week — if they start from `examples/expo-watch-app` rather than the README.
**Standout strengths:** examples as executable contracts; exports map with typed
subpaths; build preset encoding every QuickJS trap with curated error messages;
plugin robustness (idempotent, loud failures, EAS upsert, pnpm-isolated peer
resolution); secure-by-default OTA dev ergonomics (auto-generated gitignored dev
key; exact Swift trust line printed).
**Minors (unverified):** scaffold CLI hard-fails on `app.config.js/ts` projects
(use `@expo/config`'s getConfig); exact `react-reconciler@0.33.0` peer pin will
ERESOLVE-conflict with the README's unversioned install command the day 0.33.1
exists (widen to `~0.33.0` or version the documented command); two failure
messages point at the wrong fix (raw MODULE_NOT_FOUND for missing apple-targets;
on-watch "run `npm run build`" names the demo's script, not the consumer's).

### 5.7 Testing & CI — 6/10, NO
**Verdict:** the suite itself is exceptional — 334 vitest + 139 Swift test
functions with genuinely intent-encoding tests (decision-log IDs, named failure
modes like OTA freeze and NaN gate-bypass), a real multi-layer cross-language
contract, production bundles executed in real interpreters. But the pipeline is
dark (B1), the real-engine run asserts nothing (M14), and the fixture contract
is thin (M15). `pnpm test` also hard-fails on machines without Swift
(`swift format` ENOENT in codegen check) and without `qjs` (9 opaque ENOENT
failures) — contradicting CONTRIBUTING's "works anywhere" (verified here;
adjusted to minor since it's a contributor-experience issue: guard/skip with an
actionable message, and pin the Swift toolchain in the CI js job).
**Minors (unverified):** inspector server test uses a hardcoded port + fixed
400 ms boot sleep (the suite's main flake vector — poll readiness on an
ephemeral port); the reconciler's `insertBefore` keyed-move path (move to
front/middle) has no regression test — only the appendChild move-to-last case is
pinned; the publish gate runs a thinner set than main CI and no
install-from-registry smoke exists for this package (adapt the existing
post-publish-smoke pattern).

### 5.8 Release readiness — 6/10, NO
**Verdict:** release engineering unusually well-prepared *on paper* (provenance
publish job gated on real tests; verified tarball; honest checklist) — but
nothing has ever shipped (zero tags), the pipeline has never run (B1), the name
is taken (B2), and OSS table stakes are missing (M17, M18, M16).
**Minors (unverified):** the first release PR will couple this launch to six
other unreleased packages (`separate-pull-requests: false`; vscode/intellij
publish jobs hard-fail without their tokens) — drain or split before the
launch-bearing merge; checklist numbers have drifted (655 KB/111 files vs actual
682 kB/120; "320 JS tests" vs 334; R5 marks CHANGELOG ✅ though none exists yet —
it's generated on first release); no consumer-facing stability/semver statement
(the critical adopter fact that OTA bundles are wire-version-coupled — upgrading
the library strands fielded bundles until re-signed — lives only in a planning
doc).

## 6. Recommended action plan

### Now, before/with the pending merge (order matters)
1. **Fix B4** (MainActor wraps — mechanical, ~7 sites) and **B3** (lock scope) —
   both small, both must precede any E2 attempt.
2. **Fix M3 + M4** (one shared clamping helper + widget Gauge normalization +
   Linux parity tests) — same PR-sized batch as above.
3. **Re-enable GitHub Actions (B1)**, merge, and drive **one green run** of both
   workflows; make js + swift-package required checks; add nightly-failure
   notifications.
4. **Decide the npm name (B2)** — scope vs transfer vs `react-watchos` — and
   grep-replace the identity everywhere in one commit.

### Before announcing (the launch-checklist additions this review produces)
5. M8 + M10: reconcile README with status.md and the real plugin flow; refresh
   stale numbers in one pass (checklist §4 asks for exactly this).
6. M17 + M18: SECURITY.md scope, watchos issue templates, project LICENSE.
7. M16: document the consumer tsconfig contract (or ship d.ts); add the
   consumer-tsconfig CI job.
8. M14 (three-line epilogue assert) + M11 (ship `dev`/`build` bin subcommands —
   or explicitly de-scope hot reload from launch copy).
9. M13: flip `healthKit` default to false.
10. R3/R4 rehearsal against the final name: publish → install into a fresh Expo
    app → prebuild → quickstart, exactly as the checklist envisions.

### Post-launch hardening (first weeks)
11. M9 (pin vendored-engine checksums + CI verify), signed version-floor /
    expiry in `signedMessage` (revocation lever), OTA observability
    (releaseId/keyId/version telemetry for app + widget), https enforcement.
12. M5 (extract OTABootSequencer to Support + tests), M2 (depth-aware
    drainJobs), M1 (owning-queue JSRuntime confinement).
13. M15 (kitchen-sink wire fixture), engine-behavior CI on vendored ng, memory
    budget gate from the embed-host `[mem]` line.
14. M7 (i18n foundation: device locale fields + native formatting primitive).
15. The JS minor batch: fetch watchdog + signal+timeout composition, staged
    releaseId tracking, console-shim safeString, href percent-encoding, Storage
    undefined guard, setInterval floor.

## 7. Roadmap (beyond fixes — where to take the project)

**Near term (unlocks the launch story):**
- E3/E4 device pass when hardware exists: code signing, App Groups, BLE against
  a real peripheral, Instruments/battery per docs/performance-measurement.md —
  then upgrade marketing copy from simulator-grade to device-grade.
- WatchConnectivity background modes (`updateApplicationContext` /
  `transferUserInfo` outbound) — re-proposed as the top capability feature; the
  reachable-only model is the week-1 wall for companion-paired apps.
- BLE reliability pair from the first consumer: `withResponse` writes +
  auto-reconnect — prerequisites for the "remotes" category claim.
- TabView `selection`/`onChange` + range-prop vocabulary unification — free now,
  breaking later.

**Mid term (product depth):**
- i18n track (M7): locale in DeviceInfo → native date/number formatting
  primitive → documented translation pattern.
- Remote push (APNs) for standalone watch apps — absent from code and roadmap;
  unlocks alerts/messaging categories.
- Always-on display: bridge `isLuminanceReduced` as a native push + document
  AOD behavior — workout/timer apps live in that state.
- User-configurable widgets (per-instance AppIntent configuration →
  `context.instanceId` payloads) and file-backed shared assets for image
  complications.
- DX: `useScenePhase()`/`useAppState` sugar; `create-react-native-watchos`
  template; publish the SwiftPM host at co-versioned git tags for bare-Xcode
  consumers.

**Long term (strategic):**
- Execute ARCH-10 (single interpreter core + RenderContext adapters) as the
  gating step, then the multi-platform bet: the wire protocol and
  Core/Support/Runtime layers are already platform-neutral; tvOS is the natural
  second target. Revisit the package identity once ("React → SwiftUI renderer",
  not watch-specific).
- Patch wire protocol only when a device profile shows commit cost — the
  mutation stream the host config already receives is the right foundation, and
  the `v` field + capability gate give a clean activation path.
- On-device AI surface (streaming tokens over the push channel, `generateObject`
  guided generation) once watchOS 27 + Xcode 27 make it reachable — the API is
  deliberately not being designed blind.

---

*Review artifacts: 8 dimension reports + 29 adversarial verifications (session
workflow `wf_d142506a-47a`). This document supersedes no prior review; it
consolidates the current state across all of them per the docs/README.md
convention that later dated reviews win.*
