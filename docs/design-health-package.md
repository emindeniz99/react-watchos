# Design — the HEALTH package (reads, workout control, pedometer)

Shipped 2026-07-29 in four commits. This records the decisions and the
follow-ups so the *why* survives the diff, and so a later reader can tell what
was deliberately not built from what nobody thought of.

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
| The session dies from OUTSIDE | Apple ends ours when a second workout starts elsewhere. The explicit claim publishes `ended` and settles any parked start; a pump comes back on the next foreground. |

**`startHeartRate` is unchanged at the JS API level.** That was a hard
constraint, not an outcome.

### The three state-machine rules the transitions rest on

Recorded because each one shipped broken, and each fix is load-bearing for the
others (2026-07-29 review):

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
3. **The pump is invisible to the workout API.** Neither half can be enforced at
   the delegate: `endSession` clears `claim` synchronously, so by the time
   `didChangeTo(.ended)` lands it is nil for the *explicit* session too — which
   is why the `.ended` escape hatch exists at all. So the teardown site answers
   it, detaching the pump's **session** delegate (never the builder's — the
   dying pump still owes its last readings to `sensor.heartRate`) and skipping
   `recordEnded`, without which a bare `stopHeartRate()` left `getWorkoutState()`
   reporting a finished workout forever, `lastEnded` being deliberately sticky.

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

## Deliberately not v1 — each recorded as a named follow-up

| Id | What | Why deferred |
|---|---|---|
| `healthBuckets` | `HKStatisticsCollectionQueryDescriptor` (per-day buckets) | Doubles the result surface (scalar → array with bucket bounds) for a 7-invoke workaround. **Strongest of these**: 7 round trips × HealthKit query cost is a real watch battery argument. |
| `workoutRecovery` | Survive a runtime reload + `recoverActiveWorkoutSession` | v1 does the deterministic teardown the queue asked for: end + save + report via `getWorkoutState`. Keeping the session alive would let an OTA bundle inherit a workout it never started. The API is also the right answer for the **crash** case, which is worth doing regardless. |
| `healthBackground` | `HKObserverQuery` + `enableBackgroundDelivery` | A third entitlement (`…healthkit.background-delivery`) needing a provisioning change; delivery lands on the extension delegate with no live JS runtime to receive it (the same cold-launch case remote push documented as a v1 drop); and `scheduleBackgroundRefresh` already gives a bounded wake in which a health query can run. Must reuse the `background` feature's wake plumbing, not invent a second one. |
| `workoutPlans` | WorkoutKit (`WorkoutPlan`, `WorkoutScheduler`) | Floor-clean at watchOS 10.0 and fully additive, but it hands plans to **Apple's Workout app** (`openInWorkoutApp()`) — zero overlap with `HKWorkoutSession`, and a whole second model tree. |
| `pumpKillIsInvisible` | Suppress `workout.state` for a **pump** killed from outside | The teardown-site detach cannot reach it: that session was never ours to detach, and the trailing `didChangeTo(.ended)` after `didFailWithError` still passes the `.ended` escape hatch with `claim` already nil. Closing it needs identity tracking (which session's transitions are still owed to JS) rather than a claim read, so it wants its own change — half-fixing it at `didFailWithError` alone changes nothing observable, since the trailing transition leaks anyway. Impact is one spurious `workout.state{ended}` for an app that started no workout; the *stream* recovery is fixed (foreground restore). |
| `pedometerStreamErrors` | Surface a CoreMotion denial on `startPedometer` too | The invoke path now reports `PERMISSION_DENIED`, but the push channel drops its error like `startMotion`/`startGyroscope` do. Giving it an error carrier changes the `sensor` channel contract for all five kinds — a design change, not a surgical fix. |
| — | `HKQueryOptions` (`.strictStartDate`/`.strictEndDate`) | Not exposed; default `[]`. |
| — | `swimmingLocationType` / `lapLength`, `HKWorkoutActivity` multisport, `startEventUpdates`/`CMPedometerEvent`, `heartRateVariabilitySDNN`, `CMMotionActivityManager` | Additive surface with no caller yet. `CMMotionActivityManager` in particular needs no new grant — same consent — if it is ever wanted. |
| — | A demo screen exercising health | Rule 2 (nobody asked), and it would not sim-verify anyway. Reconsider when the device loop runs. |

## Verification status, stated plainly

Everything decidable without HealthKit is in `ReactWatchSupport` and runs under
`swift test` on Linux: the unit table, the statistic/type legality, the window
and limit rules, the workout request validation and the metrics-interval floor,
and the pedometer payload assembly. The ARCH-11 fixtures cross the language
boundary in both directions. `codegen.test.ts` pins every vocabulary against
its Swift enum, and `health-package-guards.test.ts` scans the watchOS-only
sources for the invariants no Linux job can compile (single construction site,
teardown order, the synchronous refusals, the crash guard, and — since the
2026-07-29 review — the UPGRADE's end-before-start, the cancellable pending
start, the pump-invisible teardown, the background block on the downgrade, the
absence of an uncalled recovery entry point, the terminal-state route stop and
the heart-rate gate).

`WorkoutSessionOwner` still has **no `swift test` coverage** — it is
`#if os(watchOS)`, so SwiftPM drops the whole target on Linux and the textual
scan is the only in-repo gate. The state-machine revision was verified by
*executing* the real sources instead: `WorkoutBridge.swift` and
`SensorBridge.swift` compile unmodified on Linux once the `#if os(watchOS)` gate
and the framework imports are stripped, against shims that keep the properties
the machine depends on (`requestAuthorization` parks its completion — that *is*
the auth window; `startActivity`/`end` report asynchronously through the
delegate, with no completion handler; `delegate` weak on both session and
builder; `endCollection`/`finishWorkout` call back off-main; `didFailWithError`
before the trailing `didChangeTo(.ended)`, per Apple). That harness is a
scratch artifact, not committed — it needs `ReactWatchHost` transcribed, which
would rot. **Standing gap unchanged:** the session, the save, the route, the
sheet and any real sample are still device-only ③.

What is **not** proven at any level: the session lifecycle, the save, the route,
the authorization sheet, and any real sample. `docs/running-on-sim.md` signs the
simulator build with *"App Group + `get-task-allow`, minus `healthkit`"* because
SpringBoard refuses the restricted entitlement without a profile — so **health
and workouts are device-only ③**. Either the sim entitlement set gains a health
branch (with a profile), or that stays the standing gap. Documenting it was the
recommendation taken; a profile-backed sim path is its own task.
