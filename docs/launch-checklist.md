# Launch-readiness checklist (pre-marketing gates)

Date: 2026-07-02 (E3 revised 2026-07-29; revised 2026-08-06 — E2/R1 rephrased
for the fresh standalone repo, numbers refreshed; revised 2026-09-17 —
E1/E2/E4/R1/R3 flipped to match actual Actions/npm state, verified against
the GitHub API). Owner-facing: this is
the honest list of what must be true before announcing the project publicly.
Each gate has a status and the evidence that flips it. Statuses: ✅ done · 🟡
ready-to-run (needs one action) · ⛔ blocked (needs hardware/accounts). Keep
this file updated as gates flip — a stale claim here defeats its purpose
(Rule 12), and that cuts **both** ways: E3 sat at ⛔ for three weeks after the
device run that cleared it, which cost the project a true claim it had already
earned.

## 1. Engineering gates

| # | Gate | Status | Evidence / action |
|---|---|---|---|
| E1 | Linux CI green on the main line (js + swift-package jobs, examples gate live) | ✅ | The examples step (NF-26) is live inside `ci.yml`'s `js` job ("Examples build a single-React bundle") and has been green on main for weeks — `ci.yml` runs on every push/PR (490+ total Actions runs across all workflows as of 2026-09-17; last confirmed green `ci.yml` run 2026-09-04, commit `416584d`). |
| E2 | macOS build workflow green (prebuild + xcodebuild watch & widget + sim tests) | ✅ | `build.yml` ("watch build") runs on every push to main touching `js/swift`, `js/plugin` or `app` (its own path filter, `build.yml:54-60`), plus nightly on schedule, on a `macos-26` runner — repeatedly green (most recently 2026-09-16, verified via the GitHub API). The "never run in Actions" state is history; it dates from before this repo's extraction. |
| E3 | Physical-device verification (code signing, App Groups, `WKRunsIndependentlyOfCompanionApp` on hardware, BLE against a real peripheral) | ✅ **at a stated scope** | **2026-07-05 run on a physical Apple Watch Ultra 3** (watchOS 26.5, paired iPhone 14 Pro), *properly* automatic-signed against real team `D68Q862K33` with the App Group provisioned by the portal — no ad-hoc/entitlement-stripping hacks. The QuickJS + renderer → SwiftUI stack **boots and renders on-wrist** ([status.md](./status.md) row 1). **Verified scope is exactly "boots + renders"** — copy may claim device support at that scope and no further. Still UNVERIFIED on hardware: Taptic haptics, Digital Crown feel, HealthKit heart-rate + GPS location streams, a complication on the live watch face, and BLE against a real peripheral (CX-022 remainder stays device-gated by decision). |
| E4 | Interpreter perf numbers on-device | ⛔ | CI produces vendored-engine numbers via `bench:qjs` (NF-20): ~1.5 ms/dispatch on x86 over the current 138-node demo tree (was 1.06 ms at NF-20; the demo grew). The on-device profile is the honest number to quote — until then, quote the x86 figure with its caveat. Full method (harness, `os_signpost`, Instruments-on-watch, MetricKit-is-phone-only): [performance-measurement.md](./performance-measurement.md). *(2026-07-16: baseline moved — ARCH-09 lazy navigation cut the launch tree to 48 nodes / 4.1 KB, ~0.52 ms/dispatch on x86; run locally. On-device stays the gate — Actions running the other suites doesn't produce this number; only Instruments-on-hardware does.)* |
| E5 | Suspense/animation/design-token gaps acknowledged | ✅ | README limitations + review §2.4; the announcement should link the honest list rather than bury it. |

Note on E1/E2: main's ruleset ("main is protected") blocks branch **deletion**
and **force-push** (`non_fast_forward`), but names no `required_status_checks`
— not configured yet (roadmap.md's pending owner action: "mark `engine attest
/ attested` a required check in branch protection"). A red `ci.yml` or
`build.yml` run does not by itself block a merge to main.

## 2. Release/packaging gates

| # | Gate | Status | Evidence / action |
|---|---|---|---|
| R1 | Package wired into release-please + npm publish with provenance | ✅ | NF-27 groundwork (`publishConfig` + `prepublishOnly`; dry-run tarball verified — 709 kB, 127 files, `npm pack --dry-run` 2026-07-04) plus the standalone-repo publish workflow. **0.2.0 onward (through 0.7.0) are published with provenance** (`npm view react-watchos@<ver> dist.attestations`, checked 2026-09-17); **0.1.0 was the manual bootstrap and carries none** — don't cite it as an attested release. *(2026-08-20: `release-please.yml` folded into `release.yml` — one run, job 1 cuts the release, job 2 publishes the tag. The FILENAME `release.yml` is load-bearing: npm matches its trusted publisher on it.)* |
| R2 | The `react-watchos` npm name actually available/owned, and the trusted publisher attached | ✅ | Name owned and published through 0.7.0. **There is no `NPM_TOKEN` and there must never be one**: auth is OIDC trusted publishing, and adding a token — or `registry-url`/`NODE_AUTH_TOKEN` on setup-node — breaks it. npm matches the publisher on org/user + repo + workflow filename (`release.yml`), one publisher per package. *(The original gate — check npmjs.com for the name BEFORE the first release PR merge; squatted name = rename before marketing, not after — is settled: `react-native-watchos` was squatted, hence B2.)* |
| R3 | First release cut (release-please PR merged, tag + GitHub release + npm publish job green) | ✅ | Happened, repeatedly, not just once: **seven automated releases (0.2.0–0.7.0)** (`gh api repos/.../releases`, checked 2026-09-17), each with a green `release.yml` publish job — 0.1.0 was the manual bootstrap (see R1), not one of these. The 0.7.0 run: `release.yml` run 33724956152, jobs `release_please` + `publish` both success. |
| R4 | Registry-install quickstart verified (not just workspace-linked) | 🟡 | The README documents the symlink caveats; a real `npm i react-watchos` skips them all — verify once against the published (or `npm pack`ed) tarball. |
| R5 | LICENSE / CHANGELOG / repository metadata | ✅ | MIT at `js/LICENSE` (shipped in `files`), CHANGELOG generated by release-please, `repository.directory` set (provenance requirement). |

## 3. Security posture (talk track for the inevitable questions)

| # | Item | Status |
|---|---|---|
| S1 | OTA is signed (Ed25519, keyId bound in signed bytes, anti-rollback, crash-loop rollback) and **refusal is the zero-config default** (NF-29) | ✅ |
| S2 | Examples model the secure path (dev keypair auto-generated + manifest always signed) | ✅ |
| S3 | Manifest freeze exposure documented with mitigations (ota-signing.md threat-model note) | ✅ |
| S4 | App Store 2.5.2 posture documented (bundled-JS interpretation permitted; OTA limited to already-reviewed functionality) — but actual review experience is UNTESTED | 🟡 statement ready; first submission is the test |
| S5 | Load-time trust boundary | ✅ stored records re-verify their Ed25519 signature at every boot when keys are enforced (NF-35) |

## 4. Marketing assets & claims discipline

- [ ] **Demo assets**: simulator screen recordings — hydration complication
  updating from the app, `TimerText` stopwatch (zero per-frame JS), Control
  Center intent updating a complication with the app closed, dev hot-reload
  loop. All capturable on the simulator today (no device needed).
- [x] **Numbers to quote** (each with its source, **re-derived 2026-07-29** —
  the previous set was three feature waves out of date; test counts refreshed
  2026-08-06):
  570-line reconciler core (`js/src/renderer.ts` `wc -l`); **41** SwiftUI-like
  primitives and **75 host methods across 24 capability features**
  ([api/capabilities.md](./api/capabilities.md), generated from
  `codegen/schema.ts` so it cannot drift); **191 KB minified app bundle +
  149 KB widget against 2 MB / 1 MB budgets** (`pnpm check:size`, run
  2026-07-29 — the old "179/146 against 200/160" quoted budgets that were
  raised on 2026-07-05); **649 vitest tests** (`vitest run`, executed
  2026-08-06 — note the codegen drift check shells out to `swift format`, so
  the suite needs the Swift toolchain present) + **`swift test` 375**
  (executed 2026-08-06 — re-derive on a Swift-capable box before quoting);
  QuickJS heap **0.7–2.1 MB** depending on bundle and boot path, ~6 MB widget
  peak (embed-host `[mem]` line); **0.5–0.75 ms/dispatch on x86** over the
  48-node lazy launch tree (until E4 — and see
  [performance-measurement.md](./performance-measurement.md) on why this
  harness cannot resolve a regression under ~40% across sessions). Counts
  drift with every feature — re-derive all of these the day you quote them.
- [ ] **Claims to make** (order matters — 2026-07-29): "React for watchOS —
  React-authored complications and Smart Stack widgets, standalone execution
  with no phone, HealthKit/workout depth, and signed OTA updates for the JS
  half, all rendering as native SwiftUI on the watch itself."
- [ ] **Claims NOT to make** (each has bitten a reviewer already): not React
  Native core (no RN ecosystem libraries — README says it first, so should
  the announcement); no device claim beyond "boots + renders" (E3 — haptics,
  Digital Crown feel, HealthKit/GPS streams and the live-face complication are
  still unverified on hardware); on-device AI is
  blocked on watchOS 27 SDK (status.md ⛔); Suspense unsupported by design.
  Also standing (2026-07-29, see
  [announcement-draft.md § Claims we do not make](./announcement-draft.md#claims-we-do-not-make)):
  no "battery-first" headline (battery is a *defensive* claim, never a
  benchmark), **no watch-user dissatisfaction / app-abandonment percentages**
  — the widely-circulated pair traces to an unsourced content farm, so the
  figures are not repeated even to disown them — no perf number without "x86"
  until E4, and no commerce/social/chat/ride-hailing/video/game demos.
- [ ] **Where the deep answers live**: architecture + alternatives → the
  2026-07-01 review; "is X real?" → status.md; security → ota-signing.md; the
  2026-07-02 self-review cycles (5 adversarial passes, 32 fixes) →
  code-review-2026-07-02-self-review-cycles.md. The widget OTA signature
  re-verification is now implemented (fail-closed); like the ~4k lines of
  reviewed SwiftUI-host Swift it awaits the macOS `swift build` (E2 — this
  pointer said E3, which is the device gate, not the build one) to compile —
  the one remaining gate, blocked on `actions:write` to dispatch it.

## 5. Suggested order of operations

1. E1 + E2 are green (see above) — keep them that way.
2. R2 (name check) → merge the release-please PR → R3/R4 rehearsal.
3. Record §4 demo assets on the simulator.
4. Draft the announcement against §4's claims lists.
5. E3's first device pass is **done** (boots + renders, 2026-07-05) — the copy
   may be upgraded to that scope now. The remaining device work is E3's
   unverified list (haptics, crown, HealthKit/GPS streams, live-face
   complication, BLE peripheral) plus E4's on-device perf numbers; upgrade the
   copy further only as each lands.
