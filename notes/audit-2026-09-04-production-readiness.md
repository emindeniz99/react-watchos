# react-watchos — production-readiness audit

Run 2026-09-04. Nine independent auditors, one per dimension; every finding then
put to adversarial verifiers instructed to refute it, defaulting to refuted when
they could not confirm it by reading the code themselves.

**60 findings verified · 45 survived · 15 refuted.** 130 agents, 2,389 tool calls, 53 minutes.

Nine verifier agents died on an API safeguard error, so nine findings were judged
by one verifier instead of two. Treat any single finding as one read, not a proof.

---

## Blocker

### The developer error banner and full-screen startup error render in RELEASE — App Store users see raw JS exception text and stack traces

`js/swift/Sources/ReactWatchHost/ReactWatchHost.swift`:2875-2891 (banner), 2867-2870 (fatal), 2849-2856 (init) — *runtime-robustness*

**Evidence**

```
ReactWatchRootView.body:
```
.overlay(alignment: .bottom) {
    // Developer-facing banner: the latest RECOVERABLE diagnostic
    if let error = model.latestRecoverable?.message {
        ScrollView { Text(error).font(.footnote.monospaced()) ... }
        .frame(maxHeight: 120)
        .background(.red.opacity(0.85), in: .rect(cornerRadius: 8))
```
and `} else if let error = model.startupError { ScrollView { Text(error).font(.footnote).foregroundStyle(.red) } }` with `var startupError: String? { latestFatal?.message }` (line 52). There is no `#if DEBUG` around either, and `public init(appGroupId:ota:useJSCallBridge:policy:)` (2849) exposes no way to turn them off. The message text is the diagnostic `details`, which for `js.promiseRejection` is built in JSRuntime.describe() as "message\nstack" — `report(Diagnostic(code: "js.\(source)", severity: .recoverable, ... details: message))` (2294). docs/debugging.md:553 admits "The error banner is developer-facing, not a user-facing error UI" but docs/debugging.md:20 lists its availability as "always".
```

**What breaks**

Any unhandled promise rejection (a `fetch()` with no `.catch` — the single most common async mistake), a `commit.decodeFailed`, an OTA boot notice, a WatchConnectivity error, or a budget breach paints a red monospaced box with a raw JS stack trace over the bottom 120pt of the shipped app's UI for real end users, and a boot failure replaces the whole screen with `JS startup failed: <Swift error description>`. It also leaks internal file names, release ids and error text to anyone holding the watch. The consumer cannot suppress it without forking the package; an `ErrorBoundary` (the documented remedy) only covers render throws, not any of the other diagnostic sources.

**Fix**

Gate both surfaces behind `#if DEBUG` (or a `showDiagnosticsOverlay: Bool = false` parameter on `ReactWatchRootView.init`), and route release-build fatals to a consumer-supplied fallback view. Keep the ring + sink unconditional; only the on-screen rendering should be developer-only.

---

## Major

| # | Finding | Where |
|---|---|---|
| 1 | Symbolication — the only documented way to read a field stack — is not in the published package | `package.json` |
| 2 | docs/ota-signing.md — the security-critical signing guide — documents repo-only npm scripts a consumer does not have | `ota-signing.md` |
| 3 | Same-version bundle replay is unblocked: an older, validly-signed bundle at the same compatibility version is treated as "fresher" and installed | `update.ts` |
| 4 | QuickJS stack guard is never sized to the hosting thread — deep JS recursion is a SIGSEGV, not a catchable error, and it defeats OTA validate() | `JSRuntime.swift` |
| 5 | TimerText `since` is not clamped against Date.distantFuture — an out-of-range epoch traps the ClosedRange in both the app and the widget interpreter | `NodeView.swift` |
| 6 | All JS console output and JS error messages are logged with `privacy: .public`, persisting consumer/user data to the unified log in release builds | `JSRuntime.swift` |
| 7 | The publish job depends on no other workflow: it re-runs ~5 gates and races the other ~20, which cannot block it | `release.yml` |
| 8 | The quickjs-ng bump bot commits as `chore(deps)`, which release-please never releases — v0.16.2 is stranded on main while npm 0.7.0 still ships v0.16.1 | `vendor-quickjs.yml` |
| 9 | The bump bot compiles and executes freshly downloaded upstream C in a job holding `contents: write` and persisted push credentials, before any human attests the tarball | `vendor-quickjs.yml` |
| 10 | No dependency-vulnerability scanning anywhere in CI, and Dependabot alerts are disabled on this public repo | `security.yml` |
| 11 | The `attested` check pair is not complementary: a PR touching the engine plus anything else runs both workflows, producing two same-named checks with opposite results | `engine-attest-pass.yml` |
| 12 | getting-started.md states an Xcode 16+ floor, but the Swift host unconditionally uses watchOS 26 SDK symbols (.glass, .glassEffect(), RelevantContext.DateKind) | `getting-started.md` |
| 13 | README and the npm-page README both say the package is not published yet; 8 versions are on npm and latest is 0.7.0 | `README.md` |
| 14 | launch-checklist.md gates E1/E2/E4/R1/R3 are all stale — they describe a repo with no Actions runs and a package published only to 0.5.0 | `launch-checklist.md` |
| 15 | The SwiftUI interpreter (NodeView, 1,617 lines) has no behavioural test — only a regex source-parity gate run from JS | `NodeView.swift` |
| 16 | No required status checks on main: two workflows document themselves as required gates that do not exist | `engine-attest.yml` |
| 17 | Documented Xcode floor ("Xcode 16+") cannot compile the package — the Swift host calls watchOS 26 SDK-only APIs guarded only by #available | `getting-started.md` |
| 18 | README Quick start still says the package is unpublished, and the Versioning section tells consumers to pin 0.1.0 — the one release with registry-install bugs | `README.md` |
| 19 | The npm-facing README's consumer tsconfig contract is obsolete and contradicts docs/getting-started.md — it demands @types/node, removed as a requirement in 0.2.0 | `README.md` |
| 20 | The example's OTA recipe sets REACT_WATCH_OTA_URL to an origin, but fetchAndApplyUpdate fetches that URL and parses it as JSON | `README.md` |
| 21 | The symbolication CLI is not in the published npm package, but the shipped CLI's own help tells you to run it | `package.json` |
| 22 | Every console.* call is written to the device's persistent unified log at `.public` privacy in RELEASE builds | `JSRuntime.swift` |
| 23 | Boot-time diagnostics — including the OTA rollback notice — are dropped and can never reach `onDiagnostic` | `ReactWatchHost.swift` |
| 24 | Uncaught JS errors and promise rejections in a release build are unreachable by any consumer API | `ReactWatchHost.swift` |
| 25 | The developer-facing error banner and full-screen error text render in RELEASE builds with no way to disable them | `ReactWatchHost.swift` |

### Detail

**1. Symbolication — the only documented way to read a field stack — is not in the published package**

`js/package.json`:60 (files), 89 (symbolicate script)

The shipped CLI can PRODUCE the symbol store (`react-watchos build --symbols <dir>` is a real flag, js/bin/react-watchos.cts:74) but a registry consumer has nothing shipped that can CONSUME it. A crash arriving from the field carries a minified frame (`at t (bundle.js:1:30)`) plus a releaseId, and the operator's only documented resolution path is a pnpm script inside a repo they do not have. Production diagnosis of a shipped watch app is a dead end.

*Fix:* Either add a `symbolicate` subcommand to bin/react-watchos.cts (it already bundles its relative imports, so scripts/symbolicate-core.ts would come along), or export `parseStackFrame`/`symbolicateFrame` from `react-watchos/manifest` (or a new `./symbolicate` subpath) and repoint docs/debugging.md and the CLI help at that.

**2. docs/ota-signing.md — the security-critical signing guide — documents repo-only npm scripts a consumer does not have**

`docs/ota-signing.md`:16, 57-60

A consumer following the dedicated signing doc gets `npm error Missing script: "ota:keygen"` on step 1 and again on step 2, with no pointer to the published API. Rotation, `OTA_SIGNING_EXPIRES_DAYS`, and the CI-secret handling are all expressed only in terms of those unreachable scripts. Until they find the one sentence in docs/getting-started.md:132, `signerPublicKeys` stays empty — which by this page's own line 31 means the app "refuses new OTA saves", so their OTA channel is dead, or they set `allowUnsignedUpdates: true` and ship a fail-open update channel (in-sandbox RCE, per the page's own opening paragraph).

*Fix:* Rewrite ota-signing.md's two code blocks against `generateSigningKey()` / `signManifest({ distDir, keyId, privateKeySeedBase64, expiresAt })` from `react-watchos/manifest` (examples/expo-watch-app/scripts/build-targets.mjs:86,98 already does exactly this and can be lifted verbatim), keeping the repo-script form only in a clearly-labelled 'in this repo' aside.

**3. Same-version bundle replay is unblocked: an older, validly-signed bundle at the same compatibility version is treated as "fresher" and installed**

`/Users/emin/emin-projects/ai-projects/react-watchos/js/src/update.ts`:503-510

Anyone who can answer the manifest URL — a compromised CDN/S3 bucket, a stolen origin credential, or simply a botched rollback of the update origin — can serve any bundle the publisher ever signed at the current compatibility `version` (which the docs say to bump only on a breaking change, so in practice every release shares one). Devices see a differing releaseId, call it fresh, download it, and the native side accepts it because `version >= highWater`. A security fix shipped over OTA can be silently un-shipped on the whole fleet, and the operator's own docs told them anti-rollback covered this.

*Fix:* Bind a monotonic, signed sequence number (or the publish timestamp) into `signedMessage` alongside `version`, persist the highest seen in the same counter store as `otaHighWater`, and refuse anything below it in `OTABootSequencer.stage`. Failing that, stop claiming replays are stopped in SECURITY.md/ota-signing.md, make `OTA_SIGNING_EXPIRES_DAYS` mandatory in `ota:sign`, and document that `expiresAt` is the only replay defence.

**4. QuickJS stack guard is never sized to the hosting thread — deep JS recursion is a SIGSEGV, not a catchable error, and it defeats OTA validate()**

`js/swift/Sources/ReactWatchRuntime/JSRuntime.swift`:174-175 (only limit set), 811-825 (guard re-anchoring)

A recursive component or a runaway reducer in the consumer's JS crashes the process with EXC_BAD_ACCESS instead of throwing a RangeError the ErrorBoundary/onError path could report — no diagnostic, no banner, no ring entry, just a crash report with a QuickJS C stack. Worse on the OTA path: `persist()` runs the candidate through the throwaway `validate` runtime specifically so "a bundle that throws on load is caught BEFORE we persist it", but a deep-recursion bundle kills the app on the validate queue instead of being rejected, so the protection is bypassed and the crash-loop counter never even records an attempt.

*Fix:* Call `JS_SetMaxStackSize(rt, …)` in `JSRuntime.init` with a value comfortably under the owning thread's real stack (e.g. 256 KB for the private-queue widget/OTA runtimes, 512 KB for the main-queue app runtime), and pin it with a test that a recursive bundle throws rather than crashes.

**5. TimerText `since` is not clamped against Date.distantFuture — an out-of-range epoch traps the ClosedRange in both the app and the widget interpreter**

`js/swift/Sources/ReactWatchHost/NodeView.swift`:474-478 (and ReactWatchWidget/ReactWidgetView.swift:393-396)

`Date.distantFuture` is ~6.4e13 epoch-ms, so any `since` above that — the classic microseconds-instead-of-milliseconds unit slip, or a computed value that overshoots — traps with `Fatal error: Range requires lowerBound <= upperBound` and hard-crashes the process. In the app it kills the whole render; in the widget extension it crashes the extension on every timeline request, so the complication stays frozen with no diagnostic. The widget copy is the more dangerous half: it is the same wire tree, and the M4 note in RNStyle.gaugeBounds says this exact class ("renders in-app, traps the extension") is what the shared normalization exists to prevent.

*Fix:* Clamp both ends the way `until` already is — e.g. `let start = Swift.min(Date(timeIntervalSince1970: sinceMs/1000), Date.distantFuture)` — and move the normalization into `RNStyle` next to `gaugeBounds` so the app and widget interpreters cannot drift again.

**6. All JS console output and JS error messages are logged with `privacy: .public`, persisting consumer/user data to the unified log in release builds**

`js/swift/Sources/ReactWatchRuntime/JSRuntime.swift`:720 (and DiagnosticsBuffer.swift:59, WidgetIntentRuntime.swift:118-121)

`os_log` interpolation defaults to `.private` (redacted as `<private>`) precisely so app data does not land in the persistent log store. By overriding to `.public` on strings the library does not control, every `console.log(user)`, every logged auth token, and every error message containing a health value or a request URL is written unredacted to the device log and swept into any sysdiagnose — including ones users send to Apple or to the app's support team. The developer has no way to opt out short of overriding `bridge.log`, which is not reachable from the public `ReactWatchRootView` API.

*Fix:* Drop the `privacy: .public` on the JS-supplied strings (keep it on the fixed fields: source, code, subsystem, node type, boot timings), or gate the public form behind `#if DEBUG`. Document the change in docs/debugging.md so developers know release logs are redacted.

**7. The publish job depends on no other workflow: it re-runs ~5 gates and races the other ~20, which cannot block it**

`.github/workflows/release.yml`:149

The npm tarball ships `swift/Package.swift`, `swift/Sources` and `swift/Tests` (js/package.json `files`). A Swift compile break, codegen drift between the TS renderer and the Swift wire models, or a packaging-map regression (publint/attw) can reach main and be published with a fully green publish job. The consumer's Xcode/SwiftPM build is where it surfaces, after they have already installed the version.

*Fix:* Either make `publish` `needs:` a job that re-runs the full ci/quality battery against the tag, or call ci.yml and quality.yml as reusable workflows from release.yml with `ref: <tag>` (the pattern vendor-quickjs.yml already uses) and gate `publish` on their results.

**8. The quickjs-ng bump bot commits as `chore(deps)`, which release-please never releases — v0.16.2 is stranded on main while npm 0.7.0 still ships v0.16.1**

`.github/workflows/vendor-quickjs.yml`:222

Consumers on react-watchos 0.7.0 get quickjs-ng v0.16.1. An engine bump merged by the bot never reaches npm on its own; it waits indefinitely for an unrelated `feat:`/`fix:` commit. A quickjs-ng security or parser fix is therefore invisible to every installed consumer, which is exactly the failure the bot was built to prevent, and it is happening right now.

*Fix:* Have the bot commit as `fix(deps): vendor quickjs-ng <tag>` (a patch bump is the correct semantic for an engine security/bugfix roll), or add a `release-as`/`Release-As:` footer to the bump commit, or add `deps` to release-please's bumping types via `changelog-sections` + `versioning`. Whatever is chosen, add a check that fails when the vendored VERSION.md moves ahead of the last released tag.

**9. The bump bot compiles and executes freshly downloaded upstream C in a job holding `contents: write` and persisted push credentials, before any human attests the tarball**

`.github/workflows/vendor-quickjs.yml`:150

A compromised or hijacked quickjs-ng release tag yields arbitrary code execution on a runner that can write any ref in the repository, including main and release tags, before any human has looked at the diff. That is the strongest write primitive in the whole pipeline, handed to the artifact the pipeline explicitly refuses to trust.

*Fix:* Split `propose` into two jobs: an unprivileged job that downloads, vendors, compiles and measures (uploading the vendored tree as an artifact), and a second job with `contents: write` + `persist-credentials: true` that only commits and pushes and executes nothing from the download. Alternatively drop the before/after measurement from the privileged job and let the reusable ci.yml call (which already runs on the pushed branch) produce it.

**10. No dependency-vulnerability scanning anywhere in CI, and Dependabot alerts are disabled on this public repo**

`.github/workflows/security.yml`:1-90 (whole file)

A CVE in a shipped runtime dependency, or in a devDependency that executes inside the `id-token: write` publish job, produces no alert and no failing check. SECURITY.md:54-69 documents that the one HIGH the project knows about (GHSA-wh4c-j3r5-mjhp in `@xmldom/xmldom@~0.7.0`) was found and remediated by hand — there is no mechanism that would find the next one.

*Fix:* Enable Dependabot alerts + security updates on the repo, add `.github/dependabot.yml` for the npm and github-actions ecosystems, and add an SCA step (osv-scanner or `pnpm audit --audit-level=high`) to security.yml so a vulnerable dependency is a visible check rather than a manual discovery.

**11. The `attested` check pair is not complementary: a PR touching the engine plus anything else runs both workflows, producing two same-named checks with opposite results**

`.github/workflows/engine-attest-pass.yml`:14-18, 24-28

docs/roadmap.md:722 instructs the owner: "**Owner action: mark `engine attest / attested` a required check in branch protection**, otherwise the label is advisory." The moment that is done, a mixed engine PR emits an always-green check run under the required name alongside the failing one, so the out-of-band digest attestation that guards the OTA trust base can be bypassed by including one unrelated file in the same PR.

*Fix:* Collapse the pair into a single always-running workflow (no paths filter) whose job inspects the PR's changed files itself and passes when no engine file changed or the `engine-digest-attested` label is present. That removes the duplicate context entirely.

**12. getting-started.md states an Xcode 16+ floor, but the Swift host unconditionally uses watchOS 26 SDK symbols (.glass, .glassEffect(), RelevantContext.DateKind)**

`docs/getting-started.md`:260

A third-party developer who reads the stated floor, installs Xcode 16, runs `expo prebuild` and builds gets hard Swift compile errors ('type has no member glass', unknown type RelevantContext.DateKind) inside a dependency they did not write, with no doc anywhere telling them the real floor is Xcode 26. This is the first wall on the install path.

*Fix:* Change the heading to the floor the project actually builds on (Xcode 26 / watchOS 26 SDK, macOS 15+), and state it in README's Quick start too — or add `#if compiler`/`canImport` guards around the watchOS 26 symbol uses if an older SDK is genuinely meant to be supported.

**13. README and the npm-page README both say the package is not published yet; 8 versions are on npm and latest is 0.7.0**

`README.md`:170-174

js/README.md is the text rendered on npmjs.com. A developer evaluating the package reads its own registry page telling them it is unpublished and that the install command is aspirational — the strongest possible signal to not adopt it. It also contradicts README.md's own Quick start two lines above, which tells them to run `npx expo install react-watchos`.

*Fix:* Delete both sentences; state the current published version and that `npx expo install react-watchos` works today.

**14. launch-checklist.md gates E1/E2/E4/R1/R3 are all stale — they describe a repo with no Actions runs and a package published only to 0.5.0**

`docs/launch-checklist.md`:17-29

This is the owner-facing gate list that decides when the project can be announced and what claims are allowed. It currently blocks on gates that cleared weeks ago and asserts provenance for 0.1.0 that the registry does not carry, so release/marketing decisions and any supply-chain statement derived from it are made on false state.

*Fix:* Flip E1/E2/E3-adjacent/R3 to ✅ with the run ids, drop 'Actions still disabled' from E4, and correct R1 to '0.2.0 onward are published with provenance; 0.1.0 was the manual bootstrap and carries none'.

**15. The SwiftUI interpreter (NodeView, 1,617 lines) has no behavioural test — only a regex source-parity gate run from JS**

`js/swift/Sources/ReactWatchHost/NodeView.swift`:37

NodeView is the code that turns every committed wire tree into the UI a consumer's users see. A wrong prop mapping (padding applied as margin, an alignment inverted, a case falling through) compiles, passes the regex parity gate — which only checks WHICH props are read, never how — and ships. The consumer's only feedback loop is looking at a watch.

*Fix:* Add watchOS-simulator tests that decode the committed Fixtures through NodeView and assert on the resulting view tree (or on snapshot images) for at least the layout-modifier set and the Button/List/Stack cases, running on the existing build.yml `watchos-tests` leg.

**16. No required status checks on main: two workflows document themselves as required gates that do not exist**

`.github/workflows/engine-attest.yml`:3

Every suite audited here can be red at merge time and at release time with nothing stopping the merge, and direct pushes to main are permitted. Since release.yml publishes off main, an operator's belief that "CI gates the release" is not backed by configuration. The engine-attest control specifically — a human out-of-band digest check on the JS engine in the trust base — is documented as blocking and is not.

*Fix:* Add a `required_status_checks` rule (and a `pull_request` rule) to the "main is protected" ruleset naming the CI, quality, build (`watchos-tests`, `build`) and `attested` job contexts, or correct the two workflow comments so they stop asserting a guarantee that does not exist.

**17. Documented Xcode floor ("Xcode 16+") cannot compile the package — the Swift host calls watchOS 26 SDK-only APIs guarded only by #available**

`docs/getting-started.md`:260

A developer who provisions the documented minimum (Xcode 16, watchOS 11 SDK) gets compile errors inside library sources they do not own — `value of type 'some View' has no member 'glassEffect'`, `.glass` is not a member of ButtonStyle, `RelevantContext.date(_:kind:)` unavailable — with nothing in the docs saying a newer Xcode is needed. First hour ends in a red build with no fix named.

*Fix:* State the real floor (Xcode 26 / watchOS 26 SDK) in docs/getting-started.md and both example READMEs, or add `#if canImport`/`compiler(>=)`-style SDK gates around the watchOS 26 call sites the way FoundationModels already has.

**18. README Quick start still says the package is unpublished, and the Versioning section tells consumers to pin 0.1.0 — the one release with registry-install bugs**

`README.md`:171-174, 353

A stranger reading the project README is told nothing is on npm (so they may not install at all), and the one concrete version string in the whole README is 0.1.0. Copying it pins the release whose pbxproj path quoting breaks the SwiftPM link on a registry install and whose esbuild preset does not pin the automatic JSX runtime — a broken prebuild plus a broken bundle build, seven releases after those were fixed.

*Fix:* Delete the "nothing is published yet" sentence and change the pin example to the current version (e.g. `"react-watchos": "0.7.0"`).

**19. The npm-facing README's consumer tsconfig contract is obsolete and contradicts docs/getting-started.md — it demands @types/node, removed as a requirement in 0.2.0**

`js/README.md`:278-286

js/README.md is the page rendered on npmjs.com — the first document a new consumer reads. It tells them to add a devDependency the package explicitly removed, and to set `types: ["node"]`, which is a *narrowing* option that suppresses automatic inclusion of every other @types package in their app. It also omits `"jsx": "react-jsx"`, which getting-started lists as part of the same contract, so a consumer who follows only the npm page cannot compile their own JSX. Two published documents give incompatible setup instructions with no way to tell which is current.

*Fix:* Replace js/README.md's "Consumer tsconfig contract" block with the getting-started `lib`/`jsx` shape, and drop the @types/node requirement sentence.

**20. The example's OTA recipe sets REACT_WATCH_OTA_URL to an origin, but fetchAndApplyUpdate fetches that URL and parses it as JSON**

`examples/expo-watch-app/README.md`:152, 156

A developer walking the example's OTA demo — the headline differentiating feature — taps "Check for update" and gets the caught-and-swallowed "update check failed" (App.tsx:56), with no indication that the URL shape is wrong. The two documents disagree, so there is nothing to compare against.

*Fix:* Change the three `http://127.0.0.1:8788` occurrences in examples/expo-watch-app/README.md and scripts/serve-ota.mjs to `http://127.0.0.1:8788/manifest.json`.

**21. The symbolication CLI is not in the published npm package, but the shipped CLI's own help tells you to run it**

`js/package.json`:60-74 (files), 105 (scripts.symbolicate)

A team that ships with `react-watchos build --symbols ./symbols` produces a symbol store exactly as documented, then a minified stack comes back from a user's watch and there is no shipped tool that reads it. `npx react-watchos symbolicate` prints the usage banner and exits 1. The only path is cloning this repo at the matching version and installing its dev dependencies — which no doc mentions. The writing half of the symbol-store feature ships; the reading half does not.

*Fix:* Add a `symbolicate` case to bin/react-watchos.cts (bundled into dist-node by scripts/build-node.ts like the other entries), move symbolicate-core.ts out of scripts/ into a shipped directory, promote @jridgewell/trace-mapping to a real dependency (or lazily require it with a clear install message), and rewrite docs/debugging.md's commands as `npx react-watchos symbolicate …`.

**22. Every console.* call is written to the device's persistent unified log at `.public` privacy in RELEASE builds**

`js/swift/Sources/ReactWatchRuntime/JSRuntime.swift`:720

`.notice` is persisted to the on-disk unified log store and `privacy: .public` defeats the automatic redaction Apple applies to interpolated strings. This package's first-class capabilities are HealthKit (js/src/health.ts, HealthQueryBridge.swift), workouts, location and Keychain, so an app that logs a heart-rate sample, a location fix, an access token or a user id — the ordinary result of leaving development console.log calls in — writes that value in cleartext into a log any sysdiagnose or paired-Mac Console.app session can read. The developer has no knob: the privacy annotation is compiled into the package.

*Fix:* Interpolate JS-supplied strings as `.private` (or `.sensitive`) by default and expose an opt-in for verbose public logging; and/or have the shipping preset default to `drop: ["console"]` with an opt-out flag. Whichever is chosen, document the release-build logging behaviour in docs/debugging.md.

**23. Boot-time diagnostics — including the OTA rollback notice — are dropped and can never reach `onDiagnostic`**

`js/swift/Sources/ReactWatchHost/ReactWatchHost.swift`:688

The one event an OTA operator most needs to see in their telemetry — "this device crash-loop-rolled back the release you just shipped, and here is the reason string" — is structurally undeliverable to the documented JS telemetry hook. A consumer can infer *that* something happened by polling `getUpdateState().bootAttempts`/`source` after boot, but the reason text and every `ota.updateRequired` / `boot.*` record are lost unless someone physically collects a sysdiagnose from the user's watch.

*Fix:* After `jsReady = true`, replay the diagnostics recorded during this boot into JS (they are already in the ring), or expose the ring through a `getDiagnostics` schema method so a bundle can drain it on startup.

**24. Uncaught JS errors and promise rejections in a release build are unreachable by any consumer API**

`js/swift/Sources/ReactWatchHost/ReactWatchHost.swift`:2292-2299

For a shipped App Store app, the most common runtime failures — a throwing onPress handler, a rejected fetch in an effect, an unawaited invoke — produce zero telemetry. They are drawn on the user's watch and written to the device log, and that is all. A developer cannot wire Sentry/Crashlytics to them, and a support engineer cannot retrieve them without a sysdiagnose from the affected user. Combined with the previous finding, the JS-side crash-reporting story for release builds is limited to React render errors.

*Fix:* Deliver `js`-subsystem diagnostics to a dedicated, non-reentrant JS hook (one that is not itself routed through `console`/the diagnostics listener table so the echo loop stays closed) — e.g. a single `onFatalJSError` callback whose own throws are swallowed — or expose the ring for draining as above.

**25. The developer-facing error banner and full-screen error text render in RELEASE builds with no way to disable them**

`js/swift/Sources/ReactWatchHost/ReactWatchHost.swift`:2875-2890

In a shipped App Store app, any unhandled promise rejection or event-handler throw paints a red monospaced bar with the raw internal error text over the user's watch UI, and a boot failure paints the whole screen red with the exception message. That message can itself contain user data. The documented mitigation does not work for the classes that actually trigger the banner, and there is no configuration to turn either surface off for production.

*Fix:* Gate both surfaces behind an explicit `ReactWatchRootView(showDiagnosticOverlays:)` (or `#if DEBUG`) defaulting to off in release, and let the app render its own fallback from `latestFatal`/`latestRecoverable`.

---

## Minor

| Finding | Where |
|---|---|
| The shipped CLI's --help points at docs/ paths that are not in the tarball | `react-watchos.cts` |
| getting-started.md states the plugin/CLI/preset ship as .cts/.mts source — they ship compiled — and offers a Node floor that cannot work | `getting-started.md` |
| The `.` and `./testing` entry points resolve to .ts under node_modules with no guidance for Jest, the default Expo/RN test runner | `package.json` |
| SECURITY.md promises per-bundle capability gating that the runtime does not implement — a bundle's declared `requiredFeatures` never narrows what it can reach | `SECURITY.md` |
| The Expo config plugin unconditionally weakens App Transport Security in every consumer's release build (`NSAllowsLocalNetworking`), with no option to turn it off and no mention in the docs | `targetConfig.cts` |
| An unknown DatePicker `mode` string traps a consumer's DEBUG build instead of degrading, unlike every other enum prop | `NodeView.swift` |
| CONTRIBUTING.md tells contributors the package was never published and has no consumers, and nothing enforces conventional commit types | `CONTRIBUTING.md` |
| `npm install -g npm@^11.5.1` is a floating range inside the OIDC-privileged publish job, directly under a comment claiming it is pinned | `release.yml` |
| README's headline Limitations list claims "CI has never run" and that Actions is disabled at the repo level — 449 runs exist and docs/status.md says the opposite | `README.md` |
| roadmap.md's "Re-prioritized what's next" list still queues three items that the same file and the shipped code mark as delivered | `roadmap.md` |
| SECURITY.md dates provenance from a version that was never published (0.1.1); the first attested release is 0.2.0 | `SECURITY.md` |
| The declared Node engine floor (>=22.18) is exercised by no CI leg — every job pins Node 24 | `package.json` |
| Declared peer-dependency floors (@bacons/apple-targets ^4, esbuild >=0.27, expo/@expo/config-plugins >=56) are never installed by any job | `package.json` |
| swift/README.md misstates the vendored quickjs-ng version as v0.16.1; actual vendored version is v0.16.2 | `README.md` |
| README Quick start omits building the JS bundle; the resulting on-watch error tells the consumer to run a script their project does not have | `README.md` |
| 0.7.0 changed published react-watchos/testing behavior with no BREAKING note and no MIGRATIONS entry | `MIGRATIONS.md` |
| `react-watchos scaffold` never writes the widget @main glue if the watch glue already exists, and the plugin's no-Swift guard is not applied to the widget target | `react-watchos.cts` |
| docs/getting-started.md claims the package has "no build step, no `prepare` hook" — it has both, and dist-node/ is gitignored | `getting-started.md` |
| Widget-extension JS errors are logged and then discarded — not in the ring, not in shared storage, not reachable from JS | `WidgetIntentRuntime.swift` |

---

## Found by the completeness critic

A tenth agent was given the surviving list and asked what all nine missed.

| Severity | Finding | Where |
|---|---|---|
| major | No Apple privacy manifest anywhere: the shipped Swift calls two required-reason API categories and the config plugin generates the watch/widget targets without a PrivacyInfo.xcprivacy | `SharedWidgetStore.swift` |
| major | The plugin hardcodes `aps-environment: development` for the watch target and its EAS credential entry, with no option to override | `targetConfig.cts` |
| major | The generated watch and widget targets ship `MARKETING_VERSION = "1.0"`; nothing in the package or its docs ties the watch app's version to the consumer's app version | `targetConfig.cts` |
| major | docs/publishing.md is the only reference for the config-plugin options and it is wrong in both directions: two documented options do not exist, four real ones are missing (including `infoPlist`, which js/README.md tells you to use) | `publishing.md` |
| minor | Neither CHANGELOG.md nor MIGRATIONS.md is in the published tarball, while the README tells consumers to read the changelog before upgrading | `package.json` |

### Detail

**No Apple privacy manifest anywhere: the shipped Swift calls two required-reason API categories and the config plugin generates the watch/widget targets without a PrivacyInfo.xcprivacy**

`/Users/emin/emin-projects/ai-projects/react-watchos/js/swift/Sources/ReactWatchSupport/SharedWidgetStore.swift`:25

The watch app is its own bundle inside the consumer's `.ipa`, and it is the bundle that contains this library's UserDefaults and file-timestamp calls. Expo's prebuild template supplies a PrivacyInfo.xcprivacy for the *iOS* app only; nothing supplies one for the plugin-generated watch or widget target. On upload the consumer gets Apple's required-reason API rejection (ITMS-91053, "Missing API declaration") for a category they never knowingly used, with no way to find out from this package's docs which reasons to declare — the package neither ships a manifest for SwiftPM to merge nor documents the CA92.1 / C617.1 declarations its own code forces.

*Fix:* Add a `PrivacyInfo.xcprivacy` declaring `NSPrivacyAccessedAPICategoryUserDefaults` (CA92.1) and `NSPrivacyAccessedAPICategoryFileTimestamp` (C617.1) as a `resources:` entry on `ReactWatchSupport` (and `ReactWatchHost`/`ReactWatchWidget`) in `js/swift/Package.swift` so SwiftPM merges it into the consumer's watch binary, and document the declarations in `docs/getting-started.md` for consumers who wire the host by hand.

**The plugin hardcodes `aps-environment: development` for the watch target and its EAS credential entry, with no option to override**

`/Users/emin/emin-projects/ai-projects/react-watchos/js/plugin/targetConfig.cts`:58-62

The comment's premise — that distribution signing rewrites the value — holds only for Xcode automatic signing. EAS Build, the canonical Expo distribution path, signs with a manual distribution profile and embeds the authored entitlements file verbatim, so the shipped TestFlight/App Store watch binary carries `aps-environment: development`. The device then registers against the APNs **sandbox**, `registerForRemoteNotifications()` returns a sandbox token, and every production push silently never arrives — with no error surfaced anywhere, and no supported way for the consumer to fix it short of patching the package.

*Fix:* Make the value an option (e.g. `pushEnvironment?: "development" | "production"`, defaulting to `development`), or derive it from the build profile; at minimum add an `entitlements` merge escape hatch alongside `infoPlist` and document the EAS/manual-signing caveat in `docs/publishing.md`.

**The generated watch and widget targets ship `MARKETING_VERSION = "1.0"`; nothing in the package or its docs ties the watch app's version to the consumer's app version**

`/Users/emin/emin-projects/ai-projects/react-watchos/js/plugin/targetConfig.cts`:196-221

Every release the consumer ships contains a watch app stamped `CFBundleShortVersionString = 1.0` while the iOS app carries its real version. Apple's upload validation for a watchOS app embedded in an iOS app requires the two to match, so the consumer either takes an ITMS version-mismatch rejection on their first non-1.0 release or ships a watch app whose user-visible version never changes — and no doc in this package, which mandates this exact plugin and generates the target config for you, mentions it.

*Fix:* Have the plugin write `MARKETING_VERSION` (or the equivalent apple-targets build-setting override) from `config.version` when generating the watch/widget target configs, and document the requirement in `docs/publishing.md` next to the `independent` warning.

**docs/publishing.md is the only reference for the config-plugin options and it is wrong in both directions: two documented options do not exist, four real ones are missing (including `infoPlist`, which js/README.md tells you to use)**

`/Users/emin/emin-projects/ai-projects/react-watchos/docs/publishing.md`:152-157

`infoPlist` is the sole escape hatch for adding required Info.plist keys to the watch target (the docs elsewhere depend on it — the plugin's own comment at targetConfig.cts:104-107 says `NSLocationWhenInUseUsageDescription` for `startLocation` "predates this option" and must be supplied through it). A consumer who needs a key cannot find the option documented, and instead finds two options that silently do nothing if they set them. The stale header additionally tells a prospective adopter the package cannot be installed from npm at all.

*Fix:* Regenerate the option block in docs/publishing.md from `ReactWatchOptions` (or move the reference into docs/getting-started.md and have a test assert the documented keys equal the interface keys), drop `families`/`entry`, and delete or rewrite the "Current state → gaps" section that describes the pre-packaging repo.

**Neither CHANGELOG.md nor MIGRATIONS.md is in the published tarball, while the README tells consumers to read the changelog before upgrading**

`/Users/emin/emin-projects/ai-projects/react-watchos/js/package.json`:60-73

A consumer upgrading 0.5.0 → 0.7.0 has, inside their installed package, no changelog and no migration guide — only a README that tells them to read a changelog that is not there. Since this package ships breaking changes across minors (MIGRATIONS.md exists precisely for that), the upgrade path is discoverable only by leaving npm and finding the right directory in the GitHub repo.

*Fix:* Add `"CHANGELOG.md"` to `files` (and either copy MIGRATIONS.md into `js/` at publish time or link it by absolute GitHub URL from the shipped README, the way js/README.md already links the project README).

---

## Refuted

Reported by an auditor, killed by verification. Listed so nobody re-files them.

| Dimension | Claim |
|---|---|
| registry-install | The compiled dist-node/ artifacts a registry install actually executes are never executed by any test or CI job |
| registry-install | engines and peerDependency floors are claims no CI leg exercises |
| security | JS and Swift resolve the manifest's `bundle` field differently; the native recovery path resolves a protocol-relative value to an attacker-chosen origin |
| security | `fetch()` accepts any URL scheme, so `file://` reads inside the app sandbox are reachable from JS with no capability gate |
| security | The vendored engine's recorded tarball digest carries a stale human-verification provenance note, so an auditor reads a bot-written digest as out-of-band verified |
| runtime-robustness | DiagnosticsSink is documented as the fleet-telemetry hook but is hardcoded in both hosts — an operator cannot get diagnostics off the device |
| ci-release | Zero required status checks exist — every CI gate in the repo is advisory, while two files claim they are required |
| docs-truth | roadmap.md claims three macOS jobs are marked required in branch protection; the repo's only branch ruleset has no required status checks at all |
| docs-truth | README and MIGRATIONS both steer new consumers to version 0.1.0 — the un-attested bootstrap release, six minors behind latest |
| test-coverage-vs-risk | The compiled Node-loaded artifacts a registry consumer actually runs are never executed — every test drives the workspace .cts/.mts source instead |
| test-coverage-vs-risk | dist-node/plugin.cjs is exercised only by a path-filtered macOS job that does not trigger on changes to the code that builds it |
| test-coverage-vs-risk | The whole ReactWatchWidget module (1,730 lines) has zero tests, including its independent Ed25519 OTA signature verification |
| test-coverage-vs-risk | The three plugin modules that exist purely to survive a registry/pnpm node_modules layout have zero test coverage |
| operability | `DiagnosticsSink` is public and documented as the fleet-telemetry extension point, but nothing accepts an implementation |
| operability | No documented operator recovery for a bad OTA bundle, and a `version` bump makes OTA rollback permanently impossible |

---

## What was NOT done

No fixes were applied. The audit was the whole scope; work stopped here
deliberately. The only change committed alongside this report is the roadmap
correction (`e4c9e6b`): tvOS dropped, and the OTA queue line that contradicted
its own feature table retired.

Four dimensions returned more findings than were verified, and the excess was
dropped rather than checked: docs-truth 5, ci-release 4, consumer-dx 4,
test-coverage-vs-risk 2, operability 1. Sixteen lower-severity findings exist
and never reached a verifier.
