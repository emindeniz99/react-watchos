# The WORKOUT-PLANS package (WorkoutKit) — design record

Shipped 2026-07-29 in five commits, closing the `workoutPlans` follow-up
[`design-health-package.md`](./design-health-package.md) recorded when the
HEALTH package landed earlier the same day. This file records the decisions, the
cuts (each with its reversal path), and — most importantly — **the one thing
about this package that is not verified and how the code stays honest about it**.

Everything below is verified against Apple's docs JSON unless labelled
otherwise. The sweep covered **124 WorkoutKit pages — the complete framework
surface** (the framework page lists exactly 14 top-level symbols; every
`topicSections` identifier of each was walked, plus 6 HealthKit pages). Where a
fact comes from WWDC rather than the docs JSON it says so, per project rule 2.

---

## 1. The two findings the whole design turns on

### (a) `WorkoutScheduler`'s mutating calls have no error channel at all

```
final func schedule(_ workout: WorkoutPlan, at: DateComponents) async     // no throws, no return
final func remove(_ workout: WorkoutPlan, at: DateComponents) async       // no throws, no return
final func removeAllWorkouts() async                                      // no throws, no return
final func markComplete(_ workout: WorkoutPlan, at: DateComponents) async // no throws, no return
```

A naked `await schedule(...)` resolves **identically** whether the plan was
stored, whether the user denied authorization, whether the device is over quota,
and whether `isSupported` is false. That is precisely the class of dishonesty the
HEALTH package spent four commits removing (`ok == true` meaning "the sheet
completed", not "the read was granted").

**So the bridge verifies by READ-BACK.** Every mutation is followed by a re-read
of `scheduledWorkouts`, and the invoke settles on what is actually there:

| op | after the mutation | if the read-back disagrees |
|---|---|---|
| `scheduleWorkoutPlan` | confirm the `(plan.id, minute)` pair is present | read `authorizationState` first, then reject `UNAVAILABLE`: *"… scheduling authorization is denied …"* when it is not `.authorized`, else *"the scheduler accepted nothing — watch-side scheduling may be unsupported on this configuration"* |
| `removeScheduledWorkoutPlan` | confirm the pair is **gone** | reject `UNAVAILABLE`: *"the scheduler removed nothing …"* |
| `removeAllScheduledWorkoutPlans` | confirm the list is empty | reject `UNAVAILABLE` naming the count still there |

`workout-plan-guards.test.ts` pins each one, and pins it harder than "a read
happens": the re-read is bound to a name, the guard's *condition* has to test
that binding, and the arm it falls into has to be able to refuse. Order alone
was not enough — `_ = await scheduler.scheduledWorkouts` followed by an
unconditional success satisfied the original assertion, which is exactly the
"stored nothing, reported success" bug this section exists to prevent, in the
one file no Linux job compiles.

One subtlety worth its own guard: the read-back compares the **minute**, not raw
`DateComponents`. Apple may normalise the components it stores (an era, a
calendar, a time zone we never set), and a raw `DateComponents ==` would then be
a *false negative* — reported to the caller as "the scheduler accepted nothing",
the worst possible failure for a check whose entire job is honesty. Both sides go
through the one Linux-tested round-trip pair instead. That pair reads **only**
`year/month/day/hour/minute` and interprets them in the caller's calendar:
`Calendar.date(from:)` honours a `timeZone` carried *on* the components over the
calendar's own, so an entry that came back tagged UTC would convert hours off and
turn the tolerance into the very false negative it was written to prevent. (`era`,
`second` and a stapled `calendar` are inert — all three verified on Linux;
`timeZone` is not.)

### (b) The project-level risk is whether scheduling works *from the watch* at all

Every `WorkoutScheduler` member carries `watchOS 10.0` in the docs JSON with no
caveat. But Apple's own sample (`workoutkit/customizing-workouts-with-workoutkit`)
is **iOS 18.0 / Xcode 16.0, with no watchOS row** — it schedules on iPhone and
reads the result on the watch — and `openInWorkoutApp()` is the one API that is
**watchOS + macOS only, not iOS**. That asymmetry reads as: Apple's designed flow
is compose-on-phone → schedule → appears-on-watch, and on the watch you open it
now. This project has no iOS-side JS runtime; it is a standalone watch app
framework.

**Nothing in the docs contradicts watch-side scheduling. Nothing confirms it
end-to-end either.** The original recommendation was to spike before writing
schema. The owner overrode that: implement now, because §1(a) makes the runtime
self-honest — if the scheduler stores nothing, the caller is *told* so in the
error text rather than handed a resolved promise. The scheduling family is
therefore documented **③ device-unverified** in
[`status.md`](./status.md), and the spike is recorded below as the next
Mac-session step. `openInWorkoutApp()` is the confirmed watch-native half.

---

## 2. The availability sweep — and the package stays `@available`-free

Everything shipped is at or below the watchOS 10.0 floor. Exactly **four** symbols
in the whole framework sit above it, and all four are cut:

| Symbol | watchOS | Cut, because |
|---|---|---|
| `WorkoutStep.init(goal:alert:displayName:)` / `.displayName` | **11.0** | would be this package family's first `@available` gate. **Top follow-up** (`workoutPlanStepNames`) — WWDC24 frames per-step names as the strength/HIIT enabler, so a strength consumer hits this wall first. |
| `WorkoutGoal.poolSwimDistanceWithTime(_:_:)` | **11.0** | pool-swim-only goal, behind a gate. |
| `WorkoutAlert.power(_:unit:metric:)` ×2 + `PowerRangeAlert.init(target:metric:)` / `PowerThresholdAlert.init(target:metric:)` | **10.4** | only the current-vs-average **selector** waits; the power alerts themselves ship via the 10.0 `power(_:unit:)` / `power(zone:)` forms. |

The speed alerts' `metric:` selector **is** watchOS 10.0, so it ships. That
asymmetry is Apple's, and it is why `WorkoutPlanAlertMetric` exists and is
restricted to the two speed kinds — sending `metric` on a power alert is refused
rather than dropped, so a caller who asked for average power learns it did not
happen.

No beta symbols anywhere. **Not one `@available` in the whole health family
survives intact**, which is the property the shipped package earned.

Two facts used below are **not docs-JSON-verifiable** and are labelled as such
wherever they appear. They come from WWDC23 session 10016 (Apple-authored, but
not the docs JSON rule 2 names): the **±7-day visibility window**, and the
**"up to 15 workouts at a time"** cap. A grep of all 124 pages found **zero**
occurrences of "entitlement", **zero** of "days", no Discussion on
`WorkoutScheduler` at all, and no documented value for
`maxAllowedScheduledWorkoutCount`. Hence: **the quota is read from the constant
at runtime and 15 is never written down** (guarded).

---

## 3. Decisions

### 3.1 A new `workoutPlans` feature, not a reuse of `workouts`

The ARCH-07 test is *split when a consumer would plausibly say yes to one and no
to the other **and** the blast radius genuinely differs*. Both halves pass
decisively:

| | `workouts` (shipped) | `workoutPlans` |
|---|---|---|
| writes | a permanent `HKWorkout` into the health record (Fitness / Activity rings) | a scheduled **document**, and a placement in another app's UI |
| system resource | the ONE `HKWorkoutSession` slot | none |
| background execution | yes (`workout-processing`) | none |
| OS consent | HealthKit share authorization | **its own**, `WorkoutScheduler.requestAuthorization()` → `AuthorizationState` |
| entitlement | `com.apple.developer.healthkit` | none documented (§3.6) |

The clinching point is the last-but-one row. It is exactly the axis on which the
pedometer *stayed* under `sensors` ("a feature id that maps to no
independently-grantable consent … is a taxonomy, not an authorization unit").
WorkoutKit maps to precisely one consent, its own.

**Convention break, surfaced not buried.** Every existing feature id is a single
lowercase word (`ai`, `health`, `workouts`, `ota`, `iap`, `widgets`, …).
`workoutPlans` is the first camelCase one. `workoutplans` reads badly and `plans`
says nothing — and this id is already written into
`design-health-package.md` and `roadmap.md` as the deferred follow-up, so
matching it is worth more than lowercase purity. Recorded in the schema comment
at the declaration site; one schema edit to change if that judgement ever flips.

### 3.2 The naming hazard is real, and it shaped three names

`js/swift/Sources/ReactWatchSupport/WorkoutPlan.swift` already exists (it holds
`WorkoutStartPlan`, `WorkoutLocation`, `WorkoutStateName`, `WorkoutEndReason`).
WorkoutKit's top-level type is **also** called `WorkoutPlan`. There is no *type*
collision today, but adding one would create a real ambiguity inside the one file
that must resolve Apple's (`WorkoutPlanBridge.swift` does `import WorkoutKit`).

So: the new Support file is **`WorkoutPlanSpec.swift`** and its root type is
`WorkoutPlanSpec` — never `WorkoutPlan`. The existing file is **not** renamed
(rule 3, surgical). Every Support type here takes a `Spec` suffix where the house
convention would have said `Plan`, and the file's header says why.

A second, less obvious collision drove the **wire** names. The generated
`invokeShapes` Swift structs are emitted into the **test target**, which also
imports `ReactWatchSupport` — so a generated `struct WorkoutPlanSpec` would
shadow `ReactWatchSupport.WorkoutPlanSpec` for every test in the module. The wire
shapes are therefore `WorkoutPlanRequest` / `WorkoutPlanGoalRequest` /
`WorkoutPlanAlertRequest` / `WorkoutPlanStepRequest` / `WorkoutPlanBlockRequest`,
following the shipped `StartWorkoutRequest` / `HealthStatisticsRequest`
convention. Public TS keeps the readable name (`WorkoutPlanSpec`), exactly as
`HealthStatisticsQuery` fronts `HealthStatisticsRequest`.

### 3.3 Flat wire structs with a `kind` discriminator

The generator emits `public let` Codable structs (`swiftStruct` in
`js/codegen/generate.ts`), so a Swift enum-with-payload is not expressible; and
`PublishedRelevantContext` already established flat-plus-discriminator as the
house idiom for a tagged union on this wire.

Flat also buys the property that makes **every cut in §4 cheaply reversible**:
adding a `kind` value or an optional field never changes an existing field, so it
invalidates no shipped ARCH-11 fixture and no generated union. That is worth the
slightly worse Swift-side ergonomics.

The public TS surface is a **real discriminated union** (`WorkoutPlanSpec`,
`WorkoutPlanGoal`, `WorkoutPlanAlert`), narrowed onto the flat wire shape in
`js/src/workoutPlans.ts` — the `StartWorkoutOptions`-vs-`StartWorkoutRequest`
precedent. The union shape itself is borrowed from
[`react-native-workouts`](https://github.com/Janjiran/react-native-workouts),
which got it right; adopting that module was rejected (it is an **Expo iOS**
module with no seam into this project's codegen'd invoke contract, its curated
~20-name activity list is the option commit `2fd7739` already rejected for this
codebase, and units-on-the-wire contradicts the units-fixed-natively rule).

### 3.4 Units are fixed on the wire, and named in the field

`meters`, `seconds`, `kilocalories`, `lowerBpm`, `countPerMinute`, `watts`,
`metersPerSecond`. The shipped rule ("a unit string on the request is a drift
surface with no gate") plus `PedometerData`'s unit-in-the-field-name convention
(`currentPaceSecPerMeter`).

One documented helper ships: **`paceToMetersPerSecond(minutesPerKilometer)`**,
because a runner thinks in min/km and the reciprocal is exactly the mistake
`"fraction"`-vs-`"percent"` was named to prevent. The JSDoc notes that Apple's
API is **speed** (`UnitSpeed`) even though WWDC and every consumer app calls it
"pace" — the wire says what it is.

`WorkoutActivityType` is **reused verbatim**: WorkoutKit takes an
`HKWorkoutActivityType`, and the generated `WorkoutActivityName` switch already
maps all 81 live names → cases in both directions. Zero new vocabulary, zero
drift risk — the single largest already-paid-for win in the package.
`WorkoutLocation` is likewise reused; absent maps to WorkoutKit's own `.unknown`
default, which is deliberately **not** a third wire value.

### 3.5 The preflight is mandatory — and it is the one rule our code cannot own

The HEALTH package put `HealthStatistic.isLegal(for:)` in `ReactWatchSupport`
because the rule was knowable and Linux-testable (root rule 5). **Here the rule is
knowable only to Apple's binary.** The activity × location × goal × alert matrix
is documented nowhere and is not stable — two confirmed-in-the-wild traps:

- `CustomWorkout.supportsGoal(.energy, …)` returns **false for every**
  activity/location combination; energy goals exist only on `SingleGoalWorkout`
  (Apple Developer Forums thread 773353).
- Pace alerts are rejected for **indoor running** (DC Rainmaker, on
  TrainingPeaks' integration).

So the bridge **asks before committing**: `supportsActivity` → per-goal
`supportsGoal` → per-alert `supportsAlert`, cheapest-first, and a refusal names
the failing element by path —

```
plan.blocks[2].steps[0].alert: speedRange is not supported for activityType 'running' with location 'indoor'
plan.blocks[0].steps[1].goal: energy is not supported … — energy goals are legal only on kind:'singleGoal'
```

A wrong JSON **type** is named the same way — `plan.blocks[2].steps[0].alert.upperBpm
is the wrong JSON type — expected a number` — rather than collapsing to "needs a
`{ plan, atMs }` object", which is not merely unhelpful but false when the
envelope is well formed and one leaf is a string. The decoder's
`DecodingError.codingPath` is rendered instead of being swallowed by `try?`. One
case cannot be recovered: a fractional number in an `Int` field arrives as
`.dataCorrupted` with an *empty* path, indistinguishable from real garbage, so it
keeps the envelope message — stated rather than implied fixed.

Root rule 5 still applies, just to the caller's benefit: code answers, it is
Apple's code, and our job is to ask rather than let `schedule(_:at:)` swallow it.
What the tests can pin is **that we ask, in that order, before construction** —
not which combinations are legal. Nothing at any verification level can prove the
matrix; the table in §5 says so rather than implying coverage.

### 3.6 Scheduling identity: `atMs` ↔ `DateComponents`, through one pure pair

`schedule` / `remove` key on `(WorkoutPlan, DateComponents)`, while every other
time on this bridge is absolute ms since epoch. The conversion lives in
`WorkoutPlanSchedule` in `ReactWatchSupport`, takes its **`Calendar` as a
parameter** (never `Calendar.current`), and is therefore deterministic and
Linux-unit-testable — rare and valuable for this family. The host reads
`Calendar.current` at the call site and passes it in; a guard pins that the
bridge never reads it itself.

- **Field set is fixed at `[.year,.month,.day,.hour,.minute]`**, which makes
  `remove` match `schedule` by construction. **Granularity is one minute** —
  documented in the JSDoc and the wire doc: schedule at `…:30.500`, list
  `…:30.000`.
- **`id` is a UUID or the request is refused.** JS may omit it (native mints one
  and reports it back in the summary); a non-UUID string rejects
  `INVALID_REQUEST`. A silent substitution would make removal a permanent no-op
  the caller could never see — the silent-lie class this codebase keeps killing.
  The summary spells the id in **RFC 9562 canonical lower-case**, the form
  `crypto.randomUUID()` emits — not an echo of the caller's spelling, which
  cannot be one: `UUID.uuidString` is always upper-case, `UUID(uuidString:)`
  keeps no casing, and `scheduledWorkouts` holds a UUID value with no memory of
  the string, so `list` could not echo even if `schedule` did. Echoing on
  `schedule` alone would make the two disagree. `summary.id === myId` is the
  natural JS check and it now holds for the natural JS id.
- **Removing something absent resolves `false`, it does not reject.** A stale UI
  removing an already-completed plan is normal. Only a malformed UUID rejects.
- **`remove` passes the key it FOUND (`target.date`), never one rebuilt from
  `ref.atMs`.** `matches` is loose on purpose so a normalised entry still
  resolves; `remove(_:at:)` gets no such tolerance and has no error channel, so
  a key that misses leaves a plan unremovable by id — recoverable only by
  `removeAllScheduledWorkoutPlans`, which takes the user's other workouts with
  it. A strict no-op when Apple normalises nothing.
- **An `(id, minute)` pair already scheduled is refused before the write**,
  `INVALID_REQUEST`. `matches` is a KEY test, so if the pair is already there
  the post-write read finds the OLD entry whether WorkoutKit replaced it,
  ignored the second call, or stored a duplicate — and Apple documents none of
  the three. The refusal is what makes the pair provably absent beforehand,
  which is the only thing that turns *"it is there afterwards"* into *"this call
  stored it"*. Re-saving an edited plan is `removeScheduledWorkoutPlan` then
  `scheduleWorkoutPlan`, both read-back verified.
- **The quota is read from `maxAllowedScheduledWorkoutCount` at runtime**,
  compared against `scheduledWorkouts.count`, and refused *before* the mutation
  with both numbers named — because `schedule` has no error channel, so an
  over-quota call would otherwise surface only as "the scheduler accepted
  nothing": true, but useless.

### 3.7 `requestWorkoutPlanAuthorization` reads before it prompts

The house contract (`requestCalendarAccess`: *"calling it again returns the
standing status without re-prompting, so this doubles as the status read"*) is
what a caller expects — but **Apple does not document whether
`requestAuthorization()` re-prompts**. So the bridge reads `authorizationState`
first and calls `requestAuthorization()` only on `.notDetermined`. Two lines make
the contract true by construction and remove a "we assumed Apple behaves like
HealthKit" from the codebase.

The verdict itself is the *opposite* of HealthKit's reads and deserves the JSDoc
paragraph it gets: WorkoutKit returns a real `AuthorizationState`, where
`requestHealthAuthorization` can only report whether the sheet was going to be
shown. A reader of both files must not conclude the codebase is inconsistent.

An unknown future state degrades to `"notDetermined"` (literally "we cannot
tell"), never to a verdict — mapping it to `denied` would tell a caller the user
refused something they were never asked.

### 3.8 `openWorkoutPlanInWorkoutApp` backgrounds us

On watchOS this **launches the Workout app** (WWDC23: *"calling the preview API
will launch the Workout app"*); it does not present a sheet over us — that is the
iOS behavior. So our app leaves the foreground while the invoke is in flight, and
Apple does not document when the `async throws` returns. It uses
`USER_MEDIATED_INVOKE_TIMEOUT_MS`, and the JSDoc states plainly that resolution
means "the Workout app was handed the plan", **never** "the user started it".

It is deliberately **not** gated on `WorkoutScheduler.isSupported`: that flag
answers whether the device supports *scheduled* workouts, a different question —
and gating on it would refuse the one half of this package that is watch-native
beyond doubt. A throw maps to `UNAVAILABLE` carrying the error text;
`StateError`'s two cases (`watchNotPaired`, `workoutApplicationNotInstalled`) are
structurally unreachable here — we *are* the watch, and Workout is a system app —
so the enum is not modeled.

### 3.9 The bridge is stateless, and must never touch `WorkoutSessionOwner`

`HKWorkoutSession` is a single-occupancy stateful system resource whose whole
design problem was ownership. WorkoutKit has **none of that**: a `WorkoutPlan` is
an immutable value, the scheduler is a `shared` store of ~15 documents, and
nothing runs. So this package needs no epoch, no claim, no parked-start settle,
no `tearDownGeneration()` ordering, no `deinit` safety property, and no
background mode. One `WorkoutScheduler.shared` call per invoke.

A file named `WorkoutPlanBridge` sitting next to `WorkoutBridge` is exactly where
a future contributor would wrongly reach for the session — so
`workout-plan-guards.test.ts` pins that it never names `WorkoutSessionOwner`,
never constructs an `HKWorkoutSession`, and holds no mutable stored state at all;
and `WorkoutPlanBridge.swift` was added to the single-construction-site scan in
`health-package-guards.test.ts`, which must keep holding.

### 3.10 Plugin / entitlements: no change in v1

Zero occurrences of "entitlement" across the 124 pages, no `NS*UsageDescription`
named anywhere, and `bundleresources/entitlements/com.apple.developer.workout-kit`
is a 404 (no such page). So: **add no plugin option** — an option that emits
nothing is worse than no option (rule 2). If the device check in §6 shows
`com.apple.developer.healthkit` is in fact required, the existing `healthKit` and
`workouts` options in `js/plugin/targetConfig.cts` already emit it and the docs
can say "enable one of those". Do **not** pre-emptively add a third emitter of
the same key — the `NSHealthShareUsageDescription` clobber bug commit `26c34b4`
had to fix is exactly what happens when two blocks write one key.

---

## 4. What was cut, and the reversal path for each

Every cut is **additive behind the flat wire shape**: none of them changes an
existing field, so none invalidates a shipped fixture or a generated union.

| Cut | Reason | Reversal |
|---|---|---|
| `SwimBikeRunWorkout` + `.Activity` + `supportsActivityOrdering` + `HKWorkoutSwimmingLocationType` + `SingleGoalWorkout.swimmingLocation` | Triathlon-only. **No consumer in the survey ships it** (TrainingPeaks, Workout Builder, react-native-workouts, Apple's sample). The live-session side already deferred multisport for the same reason. | one `kind` value + one `activities` array field. Follow-up `workoutPlanSwimBikeRun`. |
| `WorkoutStep.displayName` (+ its init) | watchOS **11.0** — the family's first `@available`. | one optional field + one `@available(watchOS 11.0, *)` block. **Top follow-up**, `workoutPlanStepNames`. |
| `WorkoutGoal.poolSwimDistanceWithTime` | watchOS **11.0**, pool-swim only. | one goal `kind`. |
| Power alert `metric:` (`WorkoutAlertMetric` on power) | watchOS **10.4**. The alerts ship; only the current-vs-average selector waits. | widen the existing `metric` field's kind restriction + a 10.4 gate. Follow-up `workoutPlanPowerMetric`. |
| `markComplete(_:at:)` | The completion signal consumers need is the **read**: Apple's own sample has the *Workout app* set `complete` and the app refresh to see it. `listScheduledWorkoutPlans` already returns `complete`. | one op. Follow-up `workoutPlanMarkComplete`. |
| `WorkoutPlan.dataRepresentation` / `init(from:)` | Our `WorkoutPlanSpec` JSON **is** the persistence format — inspectable, diffable, version-controllable. Apple's opaque `Data` blob would be a second serialization of the same thing. | — (recorded as declined, not deferred). |
| `StateError` modeling | Structurally unreachable on watchOS (§3.8). | — (declined). |
| A separate `checkWorkoutPlanSupport` query op | Validate-on-build only. **Counterargument recorded:** a builder UI that learns illegality at submit is poor, and the JS alternative (hard-coding Apple's matrix) is the drift surface being avoided. Cost is one method whose request is a subset of the plan shape. | one op. **Reconsider the moment a consumer builds a picker UI.** Follow-up `workoutPlanSupportQuery`. |
| A demo screen | Rule 2 (nobody asked) — **but** unlike health this one *might* sim-verify. Revisit after the spike; if the sim works, an interval-builder demo would be the cheapest end-to-end proof this project has ever had for a health-adjacent feature. | — |

---

## 5. Verification, stated plainly

| Layer | What it proves | Where |
|---|---|---|
| **Linux `swift test`** (①) | `WorkoutPlanSpec` decode + validation (empty `blocks`, `iterations` ≥ 1, non-finite/non-positive goal values, inverted ranges, 1-based zones, UUID parse, kind-vs-field coherence, purpose-inside-a-block-only, the speed-only `metric`), the **`atMs` ↔ `DateComponents` round trip** with a fixed calendar, minute granularity, the absurd-instant refusal, and the `HostPolicy` denial matrix | `WorkoutPlanSpecTests`, `WorkoutPlanScheduleTests`, `HostPolicyTests` |
| **Linux vitest / codegen** (①) | schema ↔ `HostInvokeFeatures` ↔ Swift router in both directions; every plan/goal/alert/purpose/metric union pinned against its Swift enum; the JS narrowing (no field leaks across arms, absent optionals genuinely absent); ARCH-11 fixtures written by `invoke-contract.test.ts` and decoded by `InvokeContractTests.swift` | `codegen.test.ts`, `workoutPlans.test.ts`, `invoke-contract.test.ts`, `invoke-producer-keys.test.ts`, `invoke-routing.test.ts` |
| **Linux textual guard** (①) | the invariants no Linux job can compile: the bridge never names `WorkoutSessionOwner` / builds a session / holds mutable state; **every mutation is read-back verified**; the read-back compares the minute, not raw components; the `supports*` preflight precedes construction; the quota is read, never literal; auth reads before prompting; `isSupported` gates the five scheduler ops and **not** `open`; the calendar is passed in | `workout-plan-guards.test.ts` (22 checks), `health-package-guards.test.ts` |
| **Builds for watchOS** (②) | — **owed.** `WorkoutPlanBridge.swift` is `#if os(watchOS)`; only `swiftc -parse` + review ran on Linux. First `xcodebuild -sdk watchsimulator` build is the gate. |
| **Device / sim** (③) | `isSupported`, the authorization sheet, `schedule` + read-back, `openInWorkoutApp()` launching the Workout app, the branded placement, `complete` flipping after a real workout, the ±7-day window | **all owed** — see §6 |
| **Not verifiable at any level** | **the legality matrix.** Only Apple's binary knows it. The tests pin that we ask and that the rejection names the path — nothing more. |

Two initializer spellings are **assumed** and will be confirmed by the first
watchOS build, since Apple's docs JSON lists the members but not every default:
`SingleGoalWorkout(activity:location:goal:)` (relying on `swimmingLocation`
defaulting) and `UnitFrequency.countPerMinute` as the unit for the heart-rate and
cadence factories (it is the documented default of
`WorkoutAlert.heartRate(_:unit:)`, so it must exist on `UnitFrequency`). Both are
loud compile failures if wrong, not silent behavior changes.

---

## 6. The sim spike — the owner's next-Mac-session step

Recorded verbatim from the original plan's Step 0, now sequenced *after* the
implementation rather than before it. A throwaway watchOS target that imports
WorkoutKit answers, in order:

1. Does the target build and link `WorkoutKit` with **no `Package.swift`
   change**? (Expected yes — `import HealthKit` auto-links today with no
   `linkedFramework` in `js/swift/Package.swift`.)
2. `WorkoutScheduler.isSupported` on the **simulator** — true or false?
3. `await WorkoutScheduler.shared.requestAuthorization()` on the sim — does a
   sheet appear, and does it return `.authorized`?
4. `schedule` + `scheduledWorkouts` read-back on the sim — does the plan persist?
5. `openInWorkoutApp()` on the sim — does the Workout app launch with the plan?
6. Does any of 2–5 change when the sim-safe entitlement set (App Group +
   `get-task-allow`, **no** `healthkit`) is used? **This is the entitlement
   question §3.10 leaves open.**
7. `maxAllowedScheduledWorkoutCount` — print it.

**RESULTS (2026-08-06, watchOS 26.2 sim, S11 46mm, AXe-driven `/plans` demo
screen — the spike ran as a demo route, not a throwaway target):**

1. ✓ Builds and links with **no `Package.swift` change** (the 2026-08-06 ②
   build; `@preconcurrency import WorkoutKit` was needed, see status.md).
2. ✓ `isSupported` is **true** on the simulator (no call rejected
   `UNAVAILABLE`).
3. ✓ The sheet **appears** ("Connect 'React Watch'? … would like to add
   workouts to Apple Watch…") and Allow resolves `authorized`.
4. ✓ **Watch-side scheduling WORKS**: `schedule` + read-back resolved the
   stored summary (`{"activityType":"running","complete":false,"atMs":…}`),
   minute-truncated as designed. The doc's fallback guess is INVERTED by
   reality: (3)–(4) work and (5) is what fails on the sim.
5. ✗ `openInWorkoutApp()` **fails on the simulator**: rejects with the
   system's own words — `The request to open "com.apple.SessionTrackerApp"
   failed.` The watchOS sim will not open the Workout app; this half stays
   device-③. (The rejection surfacing verbatim is the CX-022-style error
   plumbing doing its job.)
6. ✓ The sim-safe entitlement set (App Group + `get-task-allow`, **no**
   `healthkit`) does NOT block WorkoutKit — everything above ran under it, so
   §3.10's open question closes: no entitlement is needed for the scheduler.
7. The quota is not readable from JS by design; empirically the sim accepted
   **41 consecutive scheduled plans with no refusal**, so
   `maxAllowedScheduledWorkoutCount` > 41 there — the WWDC23 "up to 15" figure
   does not bind the simulator. (Cleanup: `removeAllWorkouts` read-back
   confirmed empty.)

**If (3)–(4) fail on the simulator but (5) works**, the coherent v1 is
`openWorkoutPlanInWorkoutApp` alone — the half two of the three shipping
consumers surveyed actually use. Because the read-back already rejects
`UNAVAILABLE` with honest text in that case, the shipped package degrades to
exactly that shape *at runtime* without a code change; the follow-up would be to
document it, not to rebuild.

Note the entitlement asymmetry that makes this worth doing:
[`running-on-sim.md`](./running-on-sim.md) signs the sim build with *"App Group +
`get-task-allow`, minus `healthkit`"* because SpringBoard refuses the restricted
entitlement without a profile — which is why health and workouts are device-only
③. **If WorkoutKit needs no entitlement, that blocker does not apply here**, and
the watchOS simulator ships a Workout app. This could be the first health-adjacent
feature in the project that actually sim-verifies.

---

## 7. Prior art (project rule 3)

| Consumer | Kinds used | Goals | Alerts | Scheduling |
|---|---|---|---|---|
| **TrainingPeaks** (first announced adopter) | `CustomWorkout` **only** — *"Planned workouts without structure … are not supported"* | time/distance in steps | indoor run: **HR only**; outdoor run: pace + HR; cycling: power + HR + cadence | yes, *"the next 7 days' worth"* auto-sync |
| **Workout Builder: Send to Watch** | simple goal, advanced interval, paced — no multisport | time / distance / energy + open goals | HR, zone, pace, power, cadence, speed | uses **preview/send-to-watch**, not date scheduling |
| **react-native-workouts** (Expo, iOS) | all four | 4 | HR zone/range, pace/speed, cadence, power | `scheduleAndSync(date)` |
| Apple's own sample | scheduling + **reading** `complete` back | — | — | yes — the sample *reads* `complete`; the Workout app sets it |

The consumed subset is narrow and consistent, and it is exactly what shipped:
`CustomWorkout` + `SingleGoalWorkout` + `PacerWorkout`; goals
time/distance/energy/open; alerts HR (range **and** zone), pace/speed, cadence,
power. **Nobody in this sample ships `SwimBikeRunWorkout`.**

One more prior-art fact that belongs in the JSDoc rather than the code: alerts
fire more than users expect. DC Rainmaker on cycling power targets — *"you'll get
these warnings constantly as Apple is only using a 3-second averaged power"*,
every 10–15 s even with perfect compliance. Not our bug to fix; a consumer must
not ship a power alert and blame the library.

**Sources (non-docs-JSON, labelled):** WWDC23-10016 *Build custom workouts with
WorkoutKit* · WWDC24-10084 *Build custom swimming workouts with WorkoutKit* ·
TrainingPeaks adoption announcement · DC Rainmaker's structured-workout
integration write-up · Workout Builder: Send to Watch (App Store) ·
`react-native-workouts` · Apple Developer Forums thread 773353.
