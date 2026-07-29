# Design — the HEALTH package (reads, workout control, pedometer)

Shipped 2026-07-29 in four commits, plus a follow-up wave the same day that
took three of the recorded deferrals (`healthBuckets`, `workoutRecovery`,
`pumpKillIsInvisible`). This records the decisions and the remaining follow-ups
so the *why* survives the diff, and so a later reader can tell what was
deliberately not built from what nobody thought of.

Source: an Apple-docs-verified research brief (≈130 fetches of
`developer.apple.com/tutorials/data/documentation/<path>.json`, including one
per `HKWorkoutActivityType` member), plus a re-sweep during implementation.

## Availability: the whole package needs no `@available` gate

Package floor is `watchOS(.v10)` (`js/swift/Package.swift`). Every symbol used
is introduced at watchOS ≤ 10.0:

| Area | Highest `introducedAt` |
|---|---|
| `HKStatisticsQueryDescriptor` / `HKSampleQueryDescriptor` / `HKSamplePredicate` | 8.5 |
| `HKWorkoutSession.init(healthStore:configuration:)`, `.pause()`, `.resume()`, `associatedWorkoutBuilder()`, `HKLiveWorkoutBuilder` | 5.0 |
| `HKWorkoutRouteBuilder`, `HKSeriesType.workoutRoute()` | 4.0 |
| `HKCategoryValueSleepAnalysis.asleepCore/Deep/REM/Unspecified` | 9.0 |
| `HKWorkoutActivityType` — **all 84 cases** | **10.0** (`underwaterDiving`) |
| `CMPedometer` + `authorizationStatus()` | 4.0 |
| `WKBackgroundModes` | 3.0 |

**Correction to the brief, recorded:** its sweep counted 83 cases / 80 live. A
re-sweep of the enum page found **84** cases, because `pickleball` (watchOS 7.0,
live, not deprecated) was missing from it. The union therefore has **81**
members: 84 minus the three deprecated spellings (`dance` deprecated watchOS
7.0, `danceInspiredTraining` 3.0, `mixedMetabolicCardioTraining` 4.0). Project
rule 1 — pre-release, prefer the clean shape — gives no compat argument for
shipping deprecated names. The maximum `introducedAt` is unchanged at 10.0.

The only above-floor symbol the sweep found anywhere is
`HKHealthStore.getEarliestAuthorizedSampleDate(for:)` (watchOS 27.0 beta),
which nothing here uses.

## The structural decision: one workout-session owner

Apple, `HKWorkoutSession` (Discussion): *"Apple Watch runs one workout session
at a time. If a second workout starts while your workout is running, your
session receives an error, and your session ends."*

`SensorBridge` privately constructed one as a hidden heart-rate pump. An
explicit `startWorkout()` beside it would have been a **second owner of a
single-occupancy system slot**, and the failure mode is the user's heart-rate
stream dying mid-workout — on a device, in a real workout, with no test on any
CI machine able to see it.

`WorkoutSessionOwner` (`WorkoutBridge.swift`) is now the only construction
site. Both callers take a claim:

| Transition | Behavior |
|---|---|
| `startWorkout` while the pump is live | **Upgrade**: end the pump session, start the configured one, re-attach the HR reading. JS sees one uninterrupted `sensor.heartRate` subscription with a one-transition gap (documented in the JSDoc). |
| `endWorkout` while `startHeartRate` is still subscribed | **Downgrade**: end + save, then start a fresh pump on a fresh epoch — unless the app is backgrounded without `keepAliveInBackground`, in which case the restore is parked for the next foreground. |
| `endWorkout` while a `startWorkout` is still in the authorization window | **Cancel**: drop the pending start, settle its parked invoke, resolve the `endWorkout`. No session is ever created. |
| `startWorkout` while a workout runs | **Refuse synchronously**, `UNAVAILABLE`. |
| Background | The owner ends the session only when the sole claim is the pump and `keepAliveInBackground` is false. An explicit workout **pins** it. |
| The session dies from OUTSIDE | Apple ends ours when a second workout starts elsewhere. The explicit claim publishes `ended` **once** and settles any parked start; a killed **pump** publishes nothing at all, and comes back on the next foreground. |
| A session outlives the PROCESS | **Recovery**: the launch after a crash adopts it — builder, data source, delegates, claim — and publishes its state. Not the reload path; see below. |

**`startHeartRate` is unchanged at the JS API level.** That was a hard
constraint, not an outcome.

### The four state-machine rules the transitions rest on

Recorded because each one shipped broken, and each fix is load-bearing for the
others (2026-07-29 review, extended by the follow-up wave):

1. **The UPGRADE happens in the authorization completion**, not in
   `startWorkout`. That is the only call site that can reach `start()` with a
   session already live, and `start()`'s `guard session == nil` — its real
   double-auth-completion guard — silently dropped the start otherwise: no
   session, no delegate callback, and the parked invoke hanging to its 30 s
   watchdog. The pump is ended **before** the configured session is built, per
   the same Apple rule the file exists for. `restorePumpIfWanted()` is queued
   behind the upgrade on main and stands down because the workout owns the slot
   by then.
2. **`pendingStart` is a cancellable state, not just a race guard.** For the
   whole HealthKit round trip `isWorkoutActive` is true while `session` is nil,
   so `endWorkout`'s live-session guard refused the cancel *and* the workout
   started anyway once the sheet completed. The window is not just the
   first-ever sheet — Apple calls the completion without prompting once the
   types are decided, and a React effect cleanup lands in it with no tap at all.
3. **The pump is invisible to the workout API.** `claim` cannot enforce this at
   the delegate: `endSession` clears it synchronously, so by the time
   `didChangeTo(.ended)` lands it is nil for the *explicit* session too. The
   teardown site answers the half it can reach, detaching the pump's **session**
   delegate (never the builder's — the dying pump still owes its last readings
   to `sensor.heartRate`) and skipping `recordEnded`, without which a bare
   `stopHeartRate()` left `getWorkoutState()` reporting a finished workout
   forever, `lastEnded` being deliberately sticky.
4. **The rule is session IDENTITY, and it subsumes the `.ended` escape hatch.**
   The owner *names* the session it told JS about (`publishedSession`, weak) and
   the delegate publishes only for that one. This is what closed
   `pumpKillIsInvisible`: a pump killed from outside is a session we were never
   given the chance to detach, and its `didFailWithError` is followed by a
   trailing `didChangeTo(.ended)` (Apple documents that order) which passed the
   old `|| toState == .ended` disjunct — so a `startHeartRate`-only app got a
   `workout.state: "ended"` for a workout it never started. The hatch is
   **gone**, not supplemented: while it was there the identity check was dead
   weight. Clearing the name on the terminal transition also fixed a sibling
   nobody had filed — an outside kill published `"ended"` **twice**, once per
   callback. Same reasoning applied to `start()`'s catch, which is now gated on
   the explicit claim: no invoke is ever parked on a pump start, so emitting a
   terminal state for one only ever published a lie.

**Teardown order on a reload is the reverse of what first shipped.**
`tearDownGeneration()` calls `workoutOwner.tearDownForReload()` **before**
`sensors.stopAll()` and before `runtime?.shutdown()`. `stopAll()` →
`stopHeartRate()` → `releaseHeartRate()` ends the pump itself and nils the
owner's session, after which `tearDownForReload()` returns on its
`guard session != nil` *before* `detachDelegates()` — leaving the outgoing
session with this owner as its delegate, so its trailing `.ended` (and a late
`didCollectDataOf`) pushed a stale `workout.state` / `sensor.heartRate` into the
runtime `boot()` was about to install; `pushNativeEvent` is name-routed with no
generation guard. Running the workout teardown first also makes the owner's
pump-only (`wasWorkout == false`) branch reachable, which is what ends a
pump-only session on reload. Rule 3's detach covers the same leak independently;
both are kept, because the ordering additionally fixes *which* branch runs.

### Reload versus crash: two different events, and they must stay so

`recoverActiveWorkoutSession` (watchOS 5.0) closes `workoutRecovery`, and the
distinction it turns on is the one the API makes easiest to blur:

- a **runtime reload** (dev hot-reload, OTA apply) still ends the workout
  deterministically — `tearDownForReload` ends, saves, and parks the snapshot.
  The process is alive; the workout belongs to the bundle that started it; an
  incoming bundle must not inherit one it never started. That v1 decision is
  unchanged, and the ordering above is unchanged with it.
- **recovery** is process *death*. Nothing ended that session and nothing saved
  it: it is still running on the user's wrist and still holding the one slot
  watchOS allows. There is no runtime to hand it back to — the one that started
  it no longer exists — so the choice is adopt or strand, and stranding burns
  the slot for the whole next launch.

So it is called **once per process**, from `start()` (guarded by
`runtime == nil`) and never from `boot()`, which runs again on every reload.
Its completion is deliberately **not** generation-guarded either: a recovered
session was started by neither runtime, so "the runtime that started it" has no
meaning, and the live one is the only one that can report it. The next reload
ends and saves it like any other workout.

**The race that makes it subtle, and the one line that closes it.**
`recoverActiveWorkoutSession` is a healthd round trip and the JS bundle boots
inside it — so a `startHeartRate` effect can land first, take the single slot,
and (by the same Apple rule this whole file exists for) **end the session being
recovered**. The pump is therefore deferred at the one choke point every pump
start goes through, and the completion calls `restorePumpIfWanted()` on every
path: deferred by one round trip, never dropped. Executed with the guard
removed: two sessions, the orphan never adopted, `getWorkoutState()` back to
`notStarted`, nothing saved — the user's workout silently lost. A `startWorkout`
that lands inside the window wins the slot instead, and the recovered session is
ended rather than stranded.

Apple's *"you must access its builder and set up your data source and delegates
again"* is followed literally; `beginCollection` is **not** called, because the
crashed launch already began it and that data is exactly what this recovers. The
generated `WorkoutActivityName` gained a reverse map for it — the recovered
session arrives as an `HKWorkoutActivityType` case and has to be named before
`getWorkoutState()` can report it — and `WorkoutStartPlan.recovered()` holds the
two knobs with no wire payload behind them: the default metrics period (the
crashed launch's choice is unknowable) and `collectRoute: false`, because a
route resumed here would begin wherever the app relaunched and *look* complete.

**Route GPS stops on the terminal session state**, not only in the `endWorkout`
completion. `endWorkout` is not the only way a session dies — an outside kill,
a start that throws, and a start cancelled in the auth window all skip that
completion — and the route runs at `kCLLocationAccuracyBest` with no distance
filter. Worse than the drain: the stranded `routeTracking` latch made the app's
own `stopLocation()` a permanent no-op for the rest of the generation. The
`!isWorkoutActive` guard is what keeps a stale `ended` from stopping the route
of a workout that has since started — an ordering the UPGRADE makes reachable.

**`sensor.heartRate` is gated on the subscription latch**, not on the workout.
An explicit workout collects heart rate whether or not anyone called
`startHeartRate`, so ungated it pushed one listener-less event per collected
sample (~1 Hz) for the whole session — the per-sample bridge cost
`emitMetricsIfDue` coalescing exists to avoid. `workout.metrics.heartRateBpm`
is the in-workout channel; `sensor.heartRate` is `startHeartRate`'s stream.

Two patterns were reused rather than reinvented:

- **Synchronous refusal.** `ExtendedRuntimeBridge.start() -> Bool` exists
  because an asynchronous API whose refusal fires no delegate callback leaves a
  parked invoke hanging to its 30 s watchdog. `startWorkout`'s three refusals
  (already running / unknown activity / no HealthKit) are exactly that case.
- **`(id, generation, epoch)` parking.** `startActivity(with:)` is asynchronous
  with no completion handler; the outcome lands on
  `workoutSession(_:didChangeTo:)` / `didFailWithError`. `generation` is the
  CX-008 dev-reload guard, `epoch` is per-session identity, so a stale
  session's terminal callback cannot reject a start parked for a live one — the
  bug `pendingRuntimeSessionStarts` was already fixed for.

`deinit` still ends the session unconditionally — that is the safety property
P0-3 bought and it must not regress; it submits `finishWorkout`
fire-and-forget, so the save is *submitted*, not confirmed, and the supported
save path is `endWorkout()`.

## A live bug fixed along the way

`startHeartRate(cb, { keepAliveInBackground: true })` has been documented since
the sensors API shipped, and the Expo plugin emitted **no `WKBackgroundModes`
at all** (grep across `js/plugin/**`, `app/app.json`, `examples/**`: zero hits).
Apple, *Running workout sessions*: *"Apps with an active workout session can run
in the background, so you need to add the background modes capability… Workout
sessions require the Workout processing background mode."* The option was
therefore structurally unbacked. The new `workouts` plugin option emits it, and
composes with — rather than clobbering — an extended-runtime mode, per Apple's
own note that the two can both be enabled.

## Feature taxonomy (ARCH-07)

Two new features, `health` and `workouts`; pedometer under the existing
`sensors`. The operative principle is the **authorization unit**: split when a
consumer would plausibly say yes to one and no to the other *and* the blast
radius genuinely differs — the `push` vs `notifications` precedent.

| Feature | Blast radius | Why separate |
|---|---|---|
| `health` | Discloses stored health **history** — potentially years, across categories the app may never display | An app that wants live HR during a meditation timer must be able to refuse sleep-history reads |
| `workouts` | **Writes** a permanent `HKWorkout` (visible in Fitness/Activity rings), occupies the single system workout slot, grants **background execution** | Write + background + a single-occupancy system resource is a different decision from reading |
| `sensors` (existing) | Unchanged | See below |

**Why pedometer stays in `sensors`** — the inverse of the push argument.
CMPedometer is CoreMotion: the same framework, the same
`NSMotionUsageDescription`, and the **same single OS consent toggle** ("Motion
& Fitness") as the shipped `startMotion`/`startGyroscope`. A user cannot grant
one and deny the other. A feature id that maps to no independently-grantable
consent *and* shares its blast radius is a taxonomy, not an authorization unit.
*The honest wrinkle, recorded rather than glossed:* `queryPedometerData` reads
up to ~7 days of device step history, which is history-shaped. It is still the
same consent, still device-local, still the same framework — and a feature list
whose entries don't correspond to what a denial achieves is worse than a coarse
one.

`startHeartRate` stays under `sensors`: it already implied a hidden workout
session, so keeping it there changes no grant.

## Widget exposure: none, and it costs nothing

Every new method is `targets: ["watch"]`. This is handled for free rather than
special-cased: `HostInvokeFeatures.byMethod` is built from all invoke methods,
and `WidgetIntentRuntime`'s typed rejecter answers `UNAVAILABLE` for any whose
feature isn't in `HostFeatures.widget`. Substantively it is also right — the
widget's contract is decode-and-display, async HealthKit I/O inside
`getTimeline` is metered against both battery and the WidgetKit refresh budget
(P1-2 of the perf audit is that the extension already does too much), and an
`HKWorkoutSession` in an extension is a non-starter: it needs the *app's*
`workout-processing` mode and the single system slot.

A health-driven complication is fed by the **app** publishing a timeline through
`publishWidgets` — the pattern the Daypart/CX-016 design already established.

## Smaller decisions worth their line

- **Units are fixed natively, never chosen by JS.** A unit string on the request
  is a drift surface with no gate. SpO2's wire unit is named `"fraction"`
  (0…1), not `"percent"`, so nobody multiplies by 100 twice.
- **`statistic` is a closed union, not `HKStatisticsOptions`.** That OptionSet's
  cumulative and discrete halves are mutually exclusive per type and the wrong
  pairing **throws** at query time. The legality rule is code
  (`HealthStatistic.isLegal(for:)`, Linux-tested) and an illegal pairing rejects
  `INVALID_REQUEST` naming the rule — root rule 5 applied to an Apple constraint.
- **Read authorization reports no verdict.** Apple: an app *"doesn't know
  whether someone granted or denied permission to read data"*; a denied read
  returns only what the app itself wrote, and people can grant a limited
  historical window. `requestHealthAuthorization` therefore resolves
  `"prompted" | "alreadyRequested" | "unavailable"` — derived from
  `getRequestStatusForAuthorization`, the only honest signal — and every query's
  JSDoc says an empty result means denied-or-absent-or-outside-your-window.
- **Sleep is its own shape.** Jamming a category into the numeric one produces
  `value: 3` plus a magic mapping every caller must own.
- **Daily buckets reuse the scalar shapes, both ways.** `healthBuckets` was
  deferred because it "doubles the result surface (scalar → array with bucket
  bounds)" — and it turns out not to: a bucket *is* the scalar aggregate over
  one day, so `HealthStatisticsRequest` and `HealthStatisticsResult` already
  describe it, and `queryHealthDailyStatistics` adds a method rather than a
  vocabulary. There is no bucket-size option: the method name is the
  granularity, and a one-member union would only pretend to be a choice.
- **Buckets are contiguous, and the ceiling is a refusal.**
  `HKStatisticsCollection.statistics()` skips intervals with no samples ("there
  may be arbitrarily large gaps"), which would return five buckets for a week
  the user rested twice; `enumerateStatistics(from:to:)` calls its block once
  per interval with a nil quantity, which is the `value: null` the scalar query
  already means — so `length` is the number of days asked for and index *n* is
  day *n*. Its documented cost is that the final interval is the one
  *containing* the end date, so a `[midnight, midnight + 7d)` week yields an
  eighth bucket; `HealthWindow.containsBucketStart` drops it, in
  ReactWatchSupport so Linux proves it. A window past the 1000-bucket ceiling
  is **refused, not clamped** (rule 12): a truncated series is a chart that
  lies about its range. The ceiling is the sample ceiling — a bucket costs the
  wire what a sample does, so there is one number, not two rules.
- **The bucket anchor is the caller's `startMs`.** A "day" therefore begins
  where JS says it does, which keeps the time zone in the one place that has a
  calendar; a `Calendar.current` midnight natively would silently disagree with
  the labels the caller renders.
- **Activity types are name-keyed, not rawValue-keyed.** `HKWorkoutActivityType`
  is an ObjC `NS_ENUM` whose raw values Apple does not document. One schema list
  renders both the TS union and the Swift `switch`, so drift is structurally
  impossible; an unrecognized name returns `nil` and the handler refuses rather
  than defaulting to `.other` (which would record a workout the user never did).
- **No `pace` in `workout.metrics`.** HealthKit exposes no workout pace
  quantity; it would be `distance / elapsed`, which the caller can compute. Real
  pace and cadence come from CMPedometer, and the JSDoc points there.
- **Omit, don't zero-fill.** `distanceMeters` / `floorsAscended` are absent when
  the capability is: a `0` would claim "you climbed no stairs" on a watch with
  no altimeter.
- **The one cross-feature check.** `startWorkout({ collectRoute: true })` needs
  `workouts` **and** `location`. ARCH-07 gates one feature per method by design,
  so the handler does an explicit in-body `effectiveFeatures.contains("location")`
  check and rejects `POLICY_DENIED` *naming* `location`. A second method whose
  only job is flipping a bool would be worse.
- **The route rides the existing `CLLocationManager`.** Apple discourages
  instantiating `HKWorkoutRouteBuilder` directly (`seriesBuilder(for:)` instead),
  and a second location manager would double the GPS duty cycle for the same
  fixes. Ending a workout does not stop an app's own `startLocation`.
- **The CMPedometer crash guard.** Apple: *"If you don't include a usage
  description string, your app crashes when you call this API."* The bridge
  checks `NSMotionUsageDescription` before touching CoreMotion and refuses with
  an actionable `UNAVAILABLE` naming the plugin option. This is not speculative
  error handling (rule 2) — it is the documented consequence, and the `motion`
  option defaulting to `false` makes it likely. **The option must never ship
  without the guard.**
- **A CMPedometer denial is `PERMISSION_DENIED`, not `INTERNAL`.** The opposite
  of the HealthKit read rule above: `CMPedometer.authorizationStatus()` (watchOS
  4.0) *is* an honest signal, so reporting a refusal as "CoreMotion returned no
  pedometer data" was actively false — a window the user did not walk returns a
  `CMPedometerData` with **zero steps**, never nil, so nil is always a failure.
  The status is read *inside* the completion, which covers both orderings with
  one check (denied in Settings before the call, and denied at the prompt this
  very call raised). `.notDetermined` deliberately does **not** count as denial:
  CoreMotion has no request-authorization call, so the first query *is* the
  prompt, and refusing on undetermined would make consent unreachable.
- **`workouts` must not clobber the broad HealthKit read string.** Both plugin
  blocks write `NSHealthShareUsageDescription` and `workouts` runs first, so its
  `??` pre-filled the key and the `healthKit` block's fallback no-opped — a
  fitness app that sets both shipped a sheet promising heart rate while
  `health.ts` reads sleep. The `workouts` fallback is gated on `healthKit` being
  off rather than the blocks being swapped: swapping trades a read-prompt
  mismatch for a write-prompt one (`NSHealthUpdateUsageDescription` would stop
  saying "Save your workouts to Health." on an app that literally saves
  workouts).

## Taken since — the three follow-ups this wave closed

| Id | What shipped |
|---|---|
| `healthBuckets` | `queryHealthDailyStatistics` (`HKStatisticsCollectionQueryDescriptor`). The deferral's stated cost — a doubled result surface — did not materialise: a bucket is the scalar aggregate over one day, so the existing request and result shapes describe it. See the bullets above for contiguity, the anchor, and the refused ceiling. |
| `workoutRecovery` | `recoverActiveWorkoutSession` for the **crash** case, which the deferral already called "worth doing regardless". The *reload* half stays deferred **and stays deliberate**: a reload still ends + saves deterministically, and letting a workout survive one would still let an OTA bundle inherit a workout it never started. See "Reload versus crash" above. |
| `pumpKillIsInvisible` | Closed with session identity, exactly as the deferral predicted it would have to be — and it was right that a `didFailWithError`-only fix changes nothing, because the trailing transition leaks anyway. Fixing it also removed a double `"ended"` on the explicit path that had not been filed. |
| `workoutPlans` | The WORKOUT-PLANS package (WorkoutKit), same day — six invoke ops under a new `workoutPlans` feature. The deferral's stated cost, "a whole second model tree", was real but smaller than it looked: `WorkoutActivityType` is reused verbatim (WorkoutKit takes an `HKWorkoutActivityType`), so the largest piece was already paid for. Its own design record: **[design-workout-plans.md](./design-workout-plans.md)**. Note the one thing that carried over intact — Apple's scheduler mutators are non-throwing and return nothing, so the bridge verifies **by read-back**, for exactly the reason this package removed four `ok == true` lies. |

## Still deliberately not built — each recorded as a named follow-up

| Id | What | Why deferred |
|---|---|---|
| `workoutReloadSurvival` | Keep a workout alive **across a runtime reload**, re-attaching instead of ending | The other half of the old `workoutRecovery` row, and still a no: end + save + report via `getWorkoutState` is the deterministic teardown ARCH-08 asked for, and surviving would let an OTA bundle inherit a workout it never started. Recovery does **not** weaken this — it covers process death, where no runtime exists to inherit anything. |
| `healthBackground` | `HKObserverQuery` + `enableBackgroundDelivery` | A third entitlement (`…healthkit.background-delivery`) needing a provisioning change; delivery lands on the extension delegate with no live JS runtime to receive it (the same cold-launch case remote push documented as a v1 drop); and `scheduleBackgroundRefresh` already gives a bounded wake in which a health query can run. Must reuse the `background` feature's wake plumbing, not invent a second one. |
| `healthHourlyBuckets` | A bucket size other than a day | Deliberately not a parameter today. `intervalComponents` would take one line, but the *contract* questions are real — an hourly ceiling is not the daily one, and hour buckets make the anchor's time zone visible in a way a day boundary hides — and nothing has asked. Adding it later is one schema field. |
| `workoutPlanStepNames` | `WorkoutStep.displayName` (+ the init that takes it) | watchOS **11.0** — it would be this family's first `@available` gate, and the whole package is gate-free today. **The top WorkoutKit follow-up**: WWDC24 frames per-step names as the strength/HIIT enabler ("exercise types, weights, reps"), so a strength consumer hits this wall first. One optional field behind one gate when the floor moves or someone asks. |
| `workoutPlanSwimBikeRun` | `SwimBikeRunWorkout` + its `.Activity` enum | Triathlon-only, and **no consumer in the prior-art survey ships it** — the same evidence that deferred multisport on the live-session side. One `kind` value + one array field on the flat wire shape, so it invalidates no shipped fixture. |
| `workoutPlanMarkComplete` | `WorkoutScheduler.markComplete(_:at:)` | The completion signal consumers need is the **read**: Apple's own sample has the Workout app set `complete` and the app refresh to see it, and `listScheduledWorkoutPlans` already returns it. Marking on the user's behalf is a secondary op with no demonstrated caller. |
| `workoutPlanSupportQuery` | A `checkWorkoutPlanSupport` op that answers the legality matrix without building a plan | v1 validates on build and rejects `INVALID_REQUEST` naming the failing path. *Counterargument recorded rather than dismissed:* a builder UI that learns illegality only at submit is poor, and the JS alternative (hard-coding Apple's undocumented matrix) is the drift surface being avoided. Cost is one method whose request is a subset of the plan shape. **Reconsider the moment a consumer builds a picker UI.** |
| `workoutPlanPowerMetric` | The power alerts' current-vs-average selector | watchOS **10.4**. The power alerts themselves ship via the 10.0 `power(_:unit:)` / `power(zone:)` forms — only the selector waits. The SPEED selector is 10.0 and did ship, which is why `WorkoutPlanAlertMetric` exists and is refused on a power alert rather than dropped. |
| `pedometerStreamErrors` | Surface a CoreMotion denial on `startPedometer` too | The invoke path now reports `PERMISSION_DENIED`, but the push channel drops its error like `startMotion`/`startGyroscope` do. Giving it an error carrier changes the `sensor` channel contract for all five kinds — a design change, not a surgical fix. |
| — | `HKQueryOptions` (`.strictStartDate`/`.strictEndDate`) | Not exposed; default `[]`. |
| — | `swimmingLocationType` / `lapLength`, `HKWorkoutActivity` multisport, `startEventUpdates`/`CMPedometerEvent`, `heartRateVariabilitySDNN`, `CMMotionActivityManager` | Additive surface with no caller yet. `CMMotionActivityManager` in particular needs no new grant — same consent — if it is ever wanted. |
| — | A demo screen exercising health | Rule 2 (nobody asked), and it would not sim-verify anyway. Reconsider when the device loop runs. |

## Verification status, stated plainly

Everything decidable without HealthKit is in `ReactWatchSupport` and runs under
`swift test` on Linux: the unit table, the statistic/type legality, the window
and limit rules, the daily-bucket ceiling and the bucket-boundary rule, the
workout request validation, the metrics-interval floor, the recovered-session
defaults, and the pedometer payload assembly. The ARCH-11 fixtures cross the
language boundary in both directions. `codegen.test.ts` pins every vocabulary
against its Swift enum — including the activity table in *both* directions
since the reverse map landed — and `health-package-guards.test.ts` scans the
watchOS-only sources for the invariants no Linux job can compile (single
construction site, teardown order, the synchronous refusals, the crash guard,
the UPGRADE's end-before-start, the cancellable pending start, the
pump-invisible teardown, the background block on the downgrade, the absence of
an uncalled recovery entry point, the terminal-state route stop, the heart-rate
gate, and — since the follow-up wave — the identity guard replacing the `.ended`
escape hatch, the claim-gated `start()` catch, recovery's process scope and its
pump deferral, the adopt-only-when-free rule, and the contiguous-bucket
enumeration).

`WorkoutSessionOwner` still has **no `swift test` coverage** — it is
`#if os(watchOS)`, so SwiftPM drops the whole target on Linux and the textual
scan is the only in-repo gate. The state machine is verified by *executing* the
real sources instead: `WorkoutBridge.swift`, `SensorBridge.swift`,
`PedometerBridge.swift` and the generated `WorkoutActivityName.swift` compile
unmodified on Linux once the `#if os(watchOS)` gate is stripped (diff = exactly
those two lines each), against shim modules literally named
`HealthKit`/`CoreMotion`/`CoreLocation` and a transcription of the host's
workout wiring. The shims keep the properties the machine depends on:
`requestAuthorization` **and** `recoverActiveWorkoutSession` park their
completions — those *are* the two windows; `startActivity`/`end` report
asynchronously through the delegate with no completion handler; `delegate` weak
on both session and builder; `endCollection`/`finishWorkout` call back off-main;
and an outside kill delivers `didFailWithError` before the trailing
`didChangeTo(.ended)`, per Apple. 45 checks, red/green against the pre-fix
delegate rule and against a missing pump deferral. That harness is a scratch
artifact, not committed — it needs `ReactWatchHost` transcribed, which would
rot. **Standing gap unchanged:** the session, the save, the route, the sheet
and any real sample are still device-only ③.

What is **not** proven at any level: the session lifecycle, the save, the route,
the authorization sheet, and any real sample. `docs/running-on-sim.md` signs the
simulator build with *"App Group + `get-task-allow`, minus `healthkit`"* because
SpringBoard refuses the restricted entitlement without a profile — so **health
and workouts are device-only ③**. Either the sim entitlement set gains a health
branch (with a profile), or that stays the standing gap. Documenting it was the
recommendation taken; a profile-backed sim path is its own task.
