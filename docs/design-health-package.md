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
| `endWorkout` while `startHeartRate` is still subscribed | **Downgrade**: end + save, then start a fresh pump on a fresh epoch. |
| `startWorkout` while a workout runs | **Refuse synchronously**, `UNAVAILABLE`. |
| Background | The owner ends the session only when the sole claim is the pump and `keepAliveInBackground` is false. An explicit workout **pins** it. |

**`startHeartRate` is unchanged at the JS API level.** That was a hard
constraint, not an outcome.

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

`tearDownGeneration()` calls `workoutOwner.tearDownForReload()` after
`sensors.stopAll()` and before `runtime?.shutdown()` (ARCH-08 ordered
teardown). `deinit` still ends the session unconditionally — that is the safety
property P0-3 bought and it must not regress; it submits `finishWorkout`
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

## Deliberately not v1 — each recorded as a named follow-up

| Id | What | Why deferred |
|---|---|---|
| `healthBuckets` | `HKStatisticsCollectionQueryDescriptor` (per-day buckets) | Doubles the result surface (scalar → array with bucket bounds) for a 7-invoke workaround. **Strongest of these**: 7 round trips × HealthKit query cost is a real watch battery argument. |
| `workoutRecovery` | Survive a runtime reload + `recoverActiveWorkoutSession` | v1 does the deterministic teardown the queue asked for: end + save + report via `getWorkoutState`. Keeping the session alive would let an OTA bundle inherit a workout it never started. The API is also the right answer for the **crash** case, which is worth doing regardless. |
| `healthBackground` | `HKObserverQuery` + `enableBackgroundDelivery` | A third entitlement (`…healthkit.background-delivery`) needing a provisioning change; delivery lands on the extension delegate with no live JS runtime to receive it (the same cold-launch case remote push documented as a v1 drop); and `scheduleBackgroundRefresh` already gives a bounded wake in which a health query can run. Must reuse the `background` feature's wake plumbing, not invent a second one. |
| `workoutPlans` | WorkoutKit (`WorkoutPlan`, `WorkoutScheduler`) | Floor-clean at watchOS 10.0 and fully additive, but it hands plans to **Apple's Workout app** (`openInWorkoutApp()`) — zero overlap with `HKWorkoutSession`, and a whole second model tree. |
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
teardown order, the synchronous refusals, the crash guard).

What is **not** proven at any level: the session lifecycle, the save, the route,
the authorization sheet, and any real sample. `docs/running-on-sim.md` signs the
simulator build with *"App Group + `get-task-allow`, minus `healthkit`"* because
SpringBoard refuses the restricted entitlement without a profile — so **health
and workouts are device-only ③**. Either the sim entitlement set gains a health
branch (with a profile), or that stays the standing gap. Documenting it was the
recommendation taken; a profile-backed sim path is its own task.
