# Battery & power defaults

Every default in this library is the battery-safe one; anything that keeps a
radio or sensor hot is bounded or opt-in. This page is the full list, with the
reason each default is what it is.

*(Relocated from the README, 2026-07-29 — unchanged in substance. The README
keeps the summary and links here.)*

**What this page is not:** a benchmark. Nothing here is a measured on-device
power number — see [performance-measurement.md](./performance-measurement.md)
§7 for what we can and cannot claim today, and
[perf-battery-audit-2026-07-08.md](./perf-battery-audit-2026-07-08.md) for the
static audit that produced most of these defaults.

## The defaults

- **Heart rate stops in the background.** The HealthKit workout session
  behind `startHeartRate` ends on scenePhase `.background` and restarts on
  `.active` — a forgotten stop can't drain the battery overnight. A real
  workout app opts in: `startHeartRate(cb, { keepAliveInBackground: true })`,
  which needs `workouts: true` in the config plugin (that is what emits the
  `workout-processing` background mode Apple requires; without it the session
  ends on background whatever the option says). An explicit `startWorkout()`
  pins the session by design — the running-workout chip on the watch face is
  the user-visible consent for that.
- **Workout metrics are coalesced.** HealthKit collects samples at ~1 Hz;
  `workout.metrics` pushes at `metricsIntervalMs` (default 1000, floor 250)
  rather than per sample, because every push crosses the bridge and can commit
  a render. Same knob shape as `startMotion({ updateIntervalMs })`.
- **One workout session, one GPS stream.** watchOS allows a single
  `HKWorkoutSession` per process, so `startHeartRate` and `startWorkout` share
  one — a second would kill the first. `collectRoute` records from the same
  `CLLocationManager` `startLocation` uses instead of starting a second one.
  If a launch crashes mid-workout, the next one adopts the session that
  outlived it rather than leaving the slot occupied and the workout unsaved.
- **A scheduled plan is verified by reading it back.** WorkoutKit's
  `schedule`/`remove`/`removeAllWorkouts` are non-throwing and return nothing —
  they look identical whether the plan was stored, the user denied
  authorization, or the device is over its quota. So the bridge re-reads the
  scheduler and settles on what is actually there; a scheduler that stored
  nothing rejects `UNAVAILABLE` saying so, rather than resolving a success that
  did not happen. Scheduling instants are keyed to the **minute**, and the
  device's own quota is read at runtime (never a hardcoded number).
  `openWorkoutPlanInWorkoutApp` **launches the Workout app**, so your app
  leaves the foreground and resolving means "the plan was handed over", never
  "the user started it".
- **A week chart is one health query, not seven — and an hours chart is one,
  not twenty-four.** `queryHealthDailyStatistics` returns one aggregate per
  day, `queryHealthHourlyStatistics` one per hour, each from a single
  `HKStatisticsCollectionQueryDescriptor`; a loop of `queryHealthStatistics`
  pays a full HealthKit round trip per bar. Buckets are contiguous, so an
  empty day or hour is `value: null` rather than a missing entry.
- **BLE auto-reconnect is bounded.** An unexpected drop re-scans for 5
  attempts × 60 s each, then stays `disconnected` instead of scanning
  forever for a peripheral that left. Tune per connection:
  `bleConnect(uuid, { maxReconnectAttempts, reconnectWindowMs })` —
  `maxReconnectAttempts: 0` disables auto-reconnect.
- **Location defaults to ten-meter accuracy with a 10 m distance filter**
  (CoreLocation's own defaults are best-accuracy GPS with a callback on
  every micro-movement). Navigation-grade fixes are the opt-in:
  `startLocation(cb, { accuracy: "navigation", distanceFilterMeters: 0 })`.
- **Motion/gyro default to 10 Hz and tune down:**
  `startMotion(cb, { updateIntervalMs: 500 })`. Every reading crosses the
  bridge and can commit a render — the rate is a direct battery knob.
- **JS timers carry leeway** (~10% of the delay) so watchOS can coalesce
  wakeups; the `setInterval` shim floors its re-arm period, and widget
  `reloadAfter` is floored to 5 minutes to protect the WidgetKit refresh
  budget.
- **Widget reloads are coalesced and decode-first.** A burst of
  `publishWidgets()` calls collapses to one extension wake, and a reload
  arriving while the published payload is still current decodes it instead
  of booting the JS engine inside the extension.
- **You are told when nobody is looking.** On Apple Watch the display stays on
  when the wrist drops — your app keeps rendering at reduced luminance, and
  watchOS 8+ participates by *default* (the opt-out is
  `WKSupportsAlwaysOnDisplay = false`). `onLuminanceReduced(reduced => …)` is
  the signal to pause polls and animations; the handler also fires once on
  mount, so an app launched with the wrist already down learns it immediately.
  Note `scenePhase` is **not** this signal — SwiftUI defines no `ScenePhase`
  value for the Always-On state.
- **File transfers warn before they get expensive.** `transferFile` resolves
  as soon as WatchConnectivity has queued it (delivery is throttled by the
  system and can finish in a later launch, so `onFileTransfer` reports the
  outcome). Crossing the 1 MB soft cap emits a `budget` diagnostic and still
  transfers — `WCError` is the authority on what is genuinely too large.

## The idle case

The renderer is pull/event-driven — it commits only when something re-enters
JS, so it costs nothing while idle. That is the structural half of the story;
the list above is the policy half. See
[ui-guide.md](./ui-guide.md#updating-the-ui-instant-periodic-smooth) for how to
pick an update mechanism, and in particular why high-frequency UI
(`<TimerText>`) is handed to native rather than driven from React.

## How to measure any of this

[performance-measurement.md](./performance-measurement.md) — the
`tools/embed-smoke` engine harness (runs on CI), `os_signpost`, Instruments on
a physical watch, why MetricKit is phone-only, and §7's explicit list of what
is claimable today. Read it before making any perf or battery claim.
[budgets-and-limits.md](./budgets-and-limits.md) is the companion table of
every budget and who may change it.
