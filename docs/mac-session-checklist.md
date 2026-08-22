# What actually needs a Mac (and what no longer does)

Written 2026-08-22, after a long Linux-only work stretch left a pile of items
labelled "Mac-owed". Most of that label is now **wrong**, and acting on the
stale version wastes the scarcest resource in this project — time in front of
an Apple Watch. This file is the sorted answer, and it is deliberately short:
the *why* for every row lives in [status.md](./status.md) and
[roadmap.md](./roadmap.md), which stay the ledgers.

The verification levels are status.md's: ① logic-tested off-device,
② compiles for watchOS + the suite runs on the simulator, ③ exercised on a
simulator or a real watch.

## Tier 0 — CI already does this. Do NOT spend a MacBook on it.

`.github/workflows/build.yml` (`watch build`) runs on a **macos-26 runner with
Xcode 26.x** on every push and on every PR touching `js/swift/**`, and it does
the whole of ②:

- `swift format lint` over `swift/Sources`, `swift/Tests` and `app/targets`
- `xcodebuild test -scheme ReactWatchHost-Package` on a **watchOS simulator**,
  after building the real JS bundle + bytecode so `BundleSmokeTests` boots the
  shipping artifacts rather than a fixture

So "does the watchOS half still compile, and do the sim tests pass" is answered
automatically, in minutes, for free. status.md's ② row still describes this as
`pnpm test:swift:watch` run by hand; that is how it *started*, not how it works
now. **Check the run before opening Xcode.**

## Tier 1 — DEFERRED to the watchOS 27 public release (owner call, 2026-08-22)

**Do not spend a session on this before mid-September 2026.** The tier needs an
Xcode carrying the watchOS 27 SDK, and on 2026-08-22 the owner's MacBook cannot
host one:

| Checked on 2026-08-22 | Value |
|---|---|
| Installed Xcode | 26.6 (build 17F113) — same generation as CI |
| watchOS SDK | 26.5 only; `FoundationModels.framework` **absent** from it |
| macOS SDK | 26.5 — has `FoundationModels.framework`, but the code sits inside `#if os(watchOS)`, so it is unreachable from a macOS build |
| Free space on `/` | 27 GB — an Xcode 27 beta plus a watchOS 27 runtime does not fit |

So the only route is a beta install that needs disk reclaimed first, to compile
against an SDK that changes again at release. Waiting until watchOS 27 and its
Xcode ship publicly (Apple's usual mid-September window) buys the stable
spelling and skips the beta churn. **Revisit trigger: the watchOS 27 SDK is in a
release Xcode.** Until then this tier's status is *blocked*, not *pending* — a
Mac session should spend itself on Tier 2 instead.

### What it is, once it is unblocked

Exactly one thing, and it is the biggest un-compiled surface in the tree:
**everything behind `#if canImport(FoundationModels)`**. FoundationModels ships
in the **watchOS 27** SDK (beta); CI's runner is Xcode 26.x, where `canImport`
is false and the entire block compiles *out*. Three waves of work sit behind
that door and have **never been compiled by anything**:

1. `generateText` streaming — `ResponseStream`/`Snapshot`, the `snapshot.content`
   element shape, `LanguageModelSession(instructions:)` (Apple's docs now show
   an `@InstructionsBuilder` init — the spelling most likely to be wrong)
2. `generateObject` — `dynamicSchema(from:)` against the real
   `DynamicGenerationSchema` initializer labels, and `GenerationSchema`'s
   duplicate-name throw
3. Tool calling — `JSBridgedTool`'s conformance (`GeneratedContent` satisfying
   both associated types), the `@concurrent` witness, `ToolCallError.underlyingError`
   unwrapping, and the double-resume guard under real cancellation

**With Xcode 27 installed, the whole tier is one command:**

```sh
pnpm --filter react-watchos test:swift:watch   # xcodebuild test, watchOS sim
```

Expect compile errors in the three areas above rather than test failures — the
Linux suite already pins the wire, the plan, the schema subset and every JS
semantic, so what is unproven is Swift *spelling* against a beta SDK. Fix the
spellings, keep the design notes' honesty sections updated, and the AI section
of the roadmap moves from "shipped, never compiled" to ②.

## Tier 2 — needs a real Apple Watch (③). A simulator cannot answer these.

Grouped by why the simulator is structurally insufficient, not by feature:

`xcrun devicectl list devices` on 2026-08-22 lists **Apple Watch Ultra 3
(Watch7,12), available (paired)** alongside the iPhone 14 Pro — so every ③ below
is reachable with the hardware already on hand, and needs no Xcode this tree
does not have. With Tier 1 deferred, this is what a Mac session is for.

**The sim build is signed WITHOUT the `healthkit` entitlement, on purpose**
(see [running-on-sim.md](./running-on-sim.md)) — so nothing below has ever
returned real data:

- Any HealthKit read against real samples: the fifteen quantity types, hourly
  buckets, sleep, saved workouts, the activity rings and their goals
- The live-update stream's deletions: a real `HKDeletedObject` naming the uuid
  its add carried (`HKDeletedObject` has no public initializer, so this join
  cannot be faked)
- `openInWorkoutApp()` and a saved `HKWorkout` with a route

**No simulator surface exists at all:**

- Smart Stack *surfacing*: whether a relevance clue actually raises the widget.
  Ranking and the clue wire are pinned; the OS's decision is unobservable
  anywhere else. Includes the open question the permission audit left: whether
  clue *evaluation* needs `NSWidgetWantsLocation` (Apple does not say)
- WatchConnectivity **file transfer** — Apple's own docs say it is not
  simulator-testable; the park/replay path additionally has no test at all, and
  [the recorded verdict](./roadmap.md) explains why a fake seam would need the
  delegate entry points refactored first
- Digital Crown **hardware** focus handoff: that flipping the `@FocusState`
  binding really moves crown input between two `digitalCrownRotation` views,
  that tap-to-steal fires `focusChange` on both nodes, and what the system does
  after a resign with no successor claim

**Timing/feel, which a simulator reports but does not predict:**

- Haptics, the crown's detents, and the 50 ms appearance deferral the focus
  claim uses
- The DAP debugger end-to-end: `react-watchos dev --debug` + `react-watchos debug`
  with an editor attached, stepping a paused watch. Its twelve
  `#if os(watchOS)` wiring lines compile in CI now, but nothing has driven the
  poll transport against a real paused runtime
- On-device numbers for the announcement draft's `[E4]` bracket — every perf
  figure there is x86, and the draft says so; a device number retires the caveat

### Getting the build onto the watch — what the 2026-08-22 attempt learned

The build half is solved and reproducible; the connection half is the part that
costs a session.

**Build (works, ~3 min):**

```sh
cd app/ios
xcodebuild build -workspace ReactWatchDemo.xcworkspace -scheme "React Watch" \
  -configuration Debug -destination 'generic/platform=watchOS' \
  -allowProvisioningUpdates
```

`generic/platform=watchOS` compiles and signs for arm64 **without the watch
present**, so a connection problem never blocks finding out whether the tree
builds. Verify the product carries what the simulator strips:

```sh
codesign -d --entitlements - --xml "…/Debug-watchos/React Watch.app"
# expect: com.apple.developer.healthkit, com.apple.security.application-groups
#         (group.com.emindeniz99.reactwatch), get-task-allow
```

That signature is the whole reason Tier 2 exists — every ③ above is unreachable
without it, and [running-on-sim.md](./running-on-sim.md) explains why the sim
build cannot have it.

**Two traps hit on the way:**

1. **`app/ios/` is gitignored and goes stale against pnpm.** Podfile.lock pins
   *hashed* store paths (`expo-constants@57.0.9_expo@57.0.10_…`), so any
   dependency wave leaves the Pods project pointing at directories that no
   longer exist. Symptom is a missing file with an innocent name —
   `PrivacyInfo.xcprivacy couldn't be opened` — from a Pods target, not from
   ours. Fix: re-run `pod install`. **It needs a UTF-8 locale**; a bare agent
   shell has none and CocoaPods 1.17 dies in `unicode_normalize` with
   `Encoding::CompatibilityError` before it reads the Podfile:

   ```sh
   LANG=en_US.UTF-8 pod install
   ```

2. **A watch that is next to the Mac is usually not ON the Mac's network.**
   watchOS keeps its Bluetooth link to the iPhone and does not join Wi-Fi while
   the phone is nearby, and Xcode reaches a watch only over `localNetwork`. The
   error is misleading — `RemotePairingError 1007`, "the device rejected the
   connection request … Ensure the device is paired with this machine" — and
   `devicectl manage pair` "succeeds" without fixing it, because pairing is a
   record and the missing thing is a route. Diagnose it in one command instead
   of guessing:

   ```sh
   dns-sd -B _remotepairing._tcp        # every device offering itself to Xcode
   dns-sd -L <instance> _remotepairing._tcp local   # which device that is
   ```

   If the only advertiser resolves to the iPhone, the watch is off-network:
   open **Settings → Wi-Fi** on the watch, join the Mac's network explicitly,
   and keep that screen lit while installing. `xcrun devicectl device info
   details --device <uuid> | grep tunnelState` is the yes/no check —
   `connected` means install will work, `disconnected` means nothing else will.

## Tier 3 — do it here (Linux), not on a Mac

Everything else, including all four of the still-open roadmap items: the
ARCH-10 single-interpreter refactor, App Shortcuts/Siri's JS + wire half, OTA
channel hardening, and the cross-platform core extraction. They are TypeScript,
codegen, wire contracts and Linux-testable Swift; a Mac adds nothing until the
watchOS half needs compiling, which Tier 0 then does automatically.

The one Linux-invisible trap to remember while doing them: a table inside
`#if os(watchOS)` is not covered by the Linux guard scans, so it fails on the
Mac job alone. `HealthQueryBridgeMappingTests` says so in its own doc comment;
assume the same of any new watchOS-only exhaustive `switch`.

## Standing owner actions (not code, not a Mac)

- Merge the release-please PR when you want the next npm release
- Mark `engine attest / attested` a **required** check in branch protection
  (the paths-ignore twin means this can no longer wedge non-engine PRs)
- Attest the bump bot's engine PR out-of-band (~28 Aug), then add the
  `engine-digest-attested` label — the bot must never attest itself
- File the two ready drafts:
  [react-native-worklets](./upstream-issues/react-native-worklets-numericliteral.md)
  (file it on the reanimated monorepo — the worklets repo redirects) and
  [@bacons/apple-targets](./upstream-issues/bacons-apple-targets-product-type.md)
