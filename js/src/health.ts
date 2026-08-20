import type {
  HealthQuantityType,
  HealthStatisticsRequest,
  ActivitySummary as WireActivitySummary,
  SleepSample as WireSleepSample,
  WorkoutActivityType,
} from "./generated/wire";
import { invoke, USER_MEDIATED_INVOKE_TIMEOUT_MS } from "./invoke";
import { registerNativeListener, type Unsubscribe } from "./nativeEvents";

/**
 * HealthKit **reads**: aggregate statistics, raw samples, and sleep stages.
 *
 * Separate from `startHeartRate` (a live push stream under the `sensors`
 * feature) and from `startWorkout` (a permanent write under `workouts`): these
 * disclose the user's stored health *history*, which is its own authorization
 * unit — an app that wants live heart rate during a meditation timer must be
 * able to refuse sleep-history reads. Gated by the `health` feature (ARCH-07).
 * {@link queryWorkoutHistory} is here rather than with `startWorkout` for
 * exactly that reason: reading years of saved workouts is a disclosure, not a
 * recording.
 *
 * {@link queryActivitySummaries} is the odd one out in shape: it reads the
 * Activity **rings** — move, exercise and stand *with their goals* — and it is
 * keyed by calendar DAY rather than by a millisecond window, because that is
 * how HealthKit stores a summary. It is also the only read here that reports a
 * goal at all: no quantity type has one, and a ring is a value measured
 * *against* a goal.
 *
 * {@link startHealthUpdates} is the only thing here that is not a read at all:
 * it SUBSCRIBES, so a screen showing today's steps or the current heart rate
 * updates itself as samples land instead of polling. It reports the same rows,
 * in the same units, as {@link queryHealthSamples} — it just does not wait to
 * be asked.
 *
 * ### The one thing to understand about HealthKit reads
 *
 * Apple, *Authorizing access to health data*: **"your app doesn't know whether
 * someone granted or denied permission to read data from HealthKit. If they
 * denied permission, attempts to read data from HealthKit return only samples
 * that your app successfully saved to the HealthKit store."** People can also
 * grant a *limited* historical window.
 *
 * So an empty result — `value: null`, `[]` — means **"denied, or no data, or
 * outside the window you were granted"**, and nothing in this API can tell you
 * which. {@link requestHealthAuthorization} reports the only honest signal
 * Apple exposes (would the sheet be shown), never a grant/deny verdict. Design
 * the UI so "no data yet" is an acceptable rendering.
 *
 * Every symbol used natively is watchOS 9.0 or below — the queries themselves
 * are the watchOS 8.5 `HK*QueryDescriptor` family; `HKWorkout.statistics(for:)`
 * (how {@link queryWorkoutHistory} reads energy and distance, since Apple
 * deprecated the `total*` properties) and the two live ring-goal spellings
 * (`exerciseTimeGoal` / `standHoursGoal`, replacing spellings Apple deprecated
 * at watchOS 27) are 9.0 — well under this package's
 * watchOS 10 floor, so nothing here is version-gated. HealthKit is
 * **device-only** in practice: the simulator run script deliberately signs
 * without the `healthkit` entitlement (see docs/running-on-sim.md), so on a
 * simulator these calls have no data to return.
 */

/** The quantity types this bridge reads. Re-exported from the generated wire
 *  module rather than re-listed: the same schema list renders the Swift unit
 *  table, so a hand copy here could disagree with what native actually reads. */
export type { HealthQuantityType };

/**
 * Which aggregate to compute. Derived from the wire request so the union can't
 * drift from the schema — which matters more than usual here:
 * `HKStatisticsOptions` is a bitmask whose cumulative and discrete halves are
 * mutually exclusive per type, and the wrong pairing **throws** natively. So
 * which of the two families a type belongs to is the one thing to look up
 * before calling — HealthKit decides it, not this package:
 *
 * - **Cumulative** — `"sum"` only. Things that accumulate over a window:
 *   `stepCount`, `flightsClimbed`, `distanceWalkingRunning`,
 *   `activeEnergyBurned`, `basalEnergyBurned`, `appleExerciseTime`,
 *   `appleStandTime`.
 * - **Discrete** — `"average" | "min" | "max" | "mostRecent"` only. Things
 *   that are *measured* at an instant: `heartRate`, `restingHeartRate`,
 *   `walkingHeartRateAverage`, `heartRateVariabilitySDNN`, `respiratoryRate`,
 *   `oxygenSaturation`, `vo2Max`.
 *
 * An illegal pairing rejects `INVALID_REQUEST` *before* the query runs, with a
 * message naming the rule.
 */
export type HealthStatistic = HealthStatisticsRequest["statistic"];

/** A sleep interval's stage (`HKCategoryValueSleepAnalysis`). */
export type SleepStage = WireSleepSample["stage"];

/** Which quantity the **move** ring measures (`HKActivityMoveMode`).
 *
 *  `"activeEnergy"` is the calorie ring most people close. `"appleMoveTime"` is
 *  the minutes ring under-18 accounts get — and anyone who chose Move Time in
 *  Settings — where {@link ActivitySummary.activeEnergyKcal} is *not* what the
 *  watch scored them on. Branch on this before drawing the move ring. */
export type ActivityMoveMode = WireActivitySummary["moveMode"];

/** What {@link requestHealthAuthorization} resolves with. Deliberately not a
 *  grant/deny verdict — HealthKit does not expose one for reads. */
export type HealthAuthorizationResult =
  | "prompted"
  | "alreadyRequested"
  | "unavailable";

/** Options for {@link requestHealthAuthorization}. */
export interface HealthAuthorizationOptions {
  /** Quantity types to ask for. */
  read: HealthQuantityType[];
  /** Also ask for sleep analysis — a HealthKit *category* type, so it isn't
   *  expressible in `read`. Required before {@link querySleepSamples}. */
  sleep?: boolean;
  /** Also ask for saved workouts (`HKObjectType.workoutType()`) — neither a
   *  quantity nor a category type, so it isn't expressible in `read` either.
   *  Required before {@link queryWorkoutHistory}. Nothing to do with the
   *  `workouts` *feature*, which authorizes *recording* a workout: this only
   *  widens the read sheet by the saved-workouts row. */
  workoutHistory?: boolean;
  /** Also ask for the Activity rings (`HKObjectType.activitySummaryType()`) —
   *  a third read type that is neither a quantity nor a category, so it isn't
   *  expressible in `read` either. Required before
   *  {@link queryActivitySummaries}.
   *
   *  Asking for it does **not** imply the `appleExerciseTime` /
   *  `appleStandTime` quantity rows, and it doesn't need them: a summary is one
   *  object carrying all three rings and their goals. Apple allows reading
   *  summaries but never *sharing* them, which is already all this package
   *  asks for. */
  activitySummaries?: boolean;
}

/** Request for {@link queryHealthStatistics}. */
export interface HealthStatisticsQuery {
  type: HealthQuantityType;
  statistic: HealthStatistic;
  /** Absolute ms since epoch (inclusive). */
  startMs: number;
  /** Absolute ms since epoch (exclusive). Must be after `startMs`. */
  endMs: number;
}

/** Request for {@link queryHealthSamples}. */
export interface HealthSamplesQuery {
  type: HealthQuantityType;
  startMs: number;
  endMs: number;
  /** Cap on samples returned. Hard ceiling 1000 — every sample crosses the
   *  bridge as JSON on a memory-tight watch. */
  limit?: number;
}

/** Request for {@link querySleepSamples}. */
export interface SleepSamplesQuery {
  startMs: number;
  endMs: number;
  /** Cap on intervals returned. Hard ceiling 1000. */
  limit?: number;
}

/** Request for {@link queryWorkoutHistory}. */
export interface WorkoutHistoryQuery {
  startMs: number;
  endMs: number;
  /** Cap on workouts returned, applied to the *whole* window before you see
   *  it. Hard ceiling 1000 — and **omitting it caps at 1000 too**, silently
   *  dropping the oldest workouts of a wider window, so a "whole year" screen
   *  should page by window rather than ask for one. If you are filtering the
   *  result down to one activity ("my last five runs"), ask for more than
   *  five. */
  limit?: number;
}

/** Request for {@link queryActivitySummaries}. Days, not milliseconds — see the
 *  function's doc for why. */
export interface ActivitySummariesQuery {
  /** First day to report, `"YYYY-MM-DD"` (zero-padded, ten characters). */
  startDate: string;
  /** Last day to report, **inclusive** — `startDate === endDate` asks for one
   *  day, which is the ask behind a rings complication (the *app* makes it and
   *  publishes the answer; see {@link queryActivitySummaries}). At most 1000
   *  days per call; a wider range rejects `INVALID_REQUEST` rather than coming
   *  back quietly truncated. */
  endDate: string;
}

/** One aggregate over a window. */
export interface HealthStatisticsResult {
  /** `null` when HealthKit returned no statistic for the window. Not
   *  distinguishable from a denied read — see the module doc. */
  value: number | null;
  /** The unit `value` is in, fixed natively per type — never chosen by the
   *  caller — and reported so a chart can label its axis:
   *
   *  - `"count"` — `stepCount`, `flightsClimbed`
   *  - `"count/min"` — every rate: `heartRate`, `restingHeartRate`,
   *    `walkingHeartRateAverage`, `respiratoryRate`
   *  - `"m"` — `distanceWalkingRunning`
   *  - `"kcal"` — `activeEnergyBurned`, `basalEnergyBurned`
   *  - `"min"` — `appleExerciseTime`, `appleStandTime`
   *  - `"ms"` — `heartRateVariabilitySDNN`, **milliseconds**: 45, not 0.045
   *  - `"fraction"` — `oxygenSaturation`, **0…1**, not 0…100
   *  - `"ml/kg/min"` — `vo2Max`. Apple states the watch estimates the 14-60
   *    range, so a value near 0.04 is a slipped unit prefix, not a reading
   */
  unit: string;
  startMs: number;
  endMs: number;
}

/** One raw quantity sample. */
export interface HealthSample {
  startMs: number;
  endMs: number;
  value: number;
  /** Same per-type unit as {@link HealthStatisticsResult.unit}. */
  unit: string;
}

/** One staged sleep interval. Sleep is not a numeric series, so it has its own
 *  shape rather than a `value: 3` plus a magic mapping every caller owns. */
export interface SleepSample {
  startMs: number;
  endMs: number;
  stage: SleepStage;
}

/**
 * One day's Activity rings: three value/goal pairs, plus the day they are for.
 *
 * The goals are why this exists. No `HKQuantityType` exposes one — reading
 * `appleExerciseTime` tells you someone exercised 23 minutes and not whether
 * that closed their ring — so an arc could not be drawn from this package at
 * all before this read.
 *
 * Every goal here is a **divisor** — an arc is `value / goal` — and two things
 * can stop one being usable: the two watchOS 9 goals cross as `null` when
 * HealthKit has none, and any goal may legitimately be `0` (HealthKit documents
 * no floor). Treat both the same way — there is no ring to draw — rather than
 * substituting Apple's defaults or dividing into an `Infinity`/`NaN` arc that
 * renders as a full or blank ring.
 *
 * Deliberately not carried: `isPaused` (watchOS 11, above this package's floor)
 * and the "activity moved to a paused state" story around it.
 */
export interface ActivitySummary {
  /** The day this row is *for*, `"YYYY-MM-DD"` — a calendar day as the user
   *  perceives it, never an instant. Every row names its own day because
   *  HealthKit returns **no row** for a day it has no summary for (a watch left
   *  on the charger), so a seven-day ask can resolve five rows and the array
   *  position is not "the nth day you asked for". Rows arrive **oldest day
   *  first**, so plotting them left to right needs no sort — but index them by
   *  this field, not by position. */
  date: string;
  /** Which pair below is the move ring — see {@link ActivityMoveMode}. */
  moveMode: ActivityMoveMode;
  /** Move ring, energy spelling: active energy burned, kcal. */
  activeEnergyKcal: number;
  /** The move ring's goal, kcal. Always present — HealthKit reports it on
   *  every summary whatever the `moveMode` is, which also means it is *not*
   *  the goal the user was scored against on an `"appleMoveTime"` day: that is
   *  {@link ActivitySummary.moveTimeGoalMinutes}. May be `0`; see the
   *  interface doc. */
  activeEnergyGoalKcal: number;
  /** Move ring, *time* spelling: Apple move time, minutes. Reported whichever
   *  mode is active, so the day a user switches modes needs no second query. */
  moveTimeMinutes: number;
  /** The move-time goal, minutes. */
  moveTimeGoalMinutes: number;
  /** Exercise ring: exercise minutes. Minutes, not milliseconds — this is a
   *  counter the watch increments and a goal set in whole minutes, not a
   *  stopwatch duration like {@link WorkoutSummary.durationMs}. */
  exerciseMinutes: number;
  /** The exercise goal, minutes, or `null` when HealthKit has none for that day
   *  (the goal became per-day in watchOS 9). `null` is **not** 30: a ring with
   *  no goal cannot be drawn, and a substituted default draws one the user was
   *  never scored against. Render it as "no goal", not as a full ring. */
  exerciseGoalMinutes: number | null;
  /** Stand ring: stand hours, a **count** of hours (the ring reads "10 of
   *  12"), not a duration. */
  standHours: number;
  /** The stand goal, in hours, or `null` — same watchOS 9 optionality and the
   *  same rule as {@link ActivitySummary.exerciseGoalMinutes}. */
  standHoursGoal: number | null;
}

/**
 * One saved workout — the fields a "recent workouts" row actually renders.
 *
 * Deliberately not everything an `HKWorkout` carries: `metadata` (free-form
 * and app-private), `device`, `sourceRevision`, `workoutEvents` (pause/lap
 * markers — a detail screen's problem, not a list's), `HKWorkoutActivity`
 * multisport segments and the full `allStatistics` map are all left off. They
 * are what a *detail* view would want, and each one is a wire cost paid by
 * every row of every list; a later method can add them without moving this
 * shape.
 */
export interface WorkoutSummary {
  /** The saved `HKWorkout`'s UUID — a stable list key, and the same id
   *  `WorkoutState.endedWorkoutId` reports for a workout this app just
   *  finished, so the two can be matched rather than guessed at. */
  id: string;
  startMs: number;
  endMs: number;
  /** Time the workout was *running*, in ms. Not `endMs - startMs`: HealthKit's
   *  `duration` excludes paused time, and this is the number a row shows. */
  durationMs: number;
  /** Omitted when this binary's vocabulary has no name for the stored
   *  activity — the list contains workouts other apps saved, so naming the
   *  wrong one would be worse than naming none. */
  activityType?: WorkoutActivityType;
  /** Active energy burned, kcal. `null` means the workout recorded **no**
   *  energy samples — a manually logged session, say — not that it burned
   *  zero. See {@link queryWorkoutHistory} for the two other things `null`
   *  covers. */
  activeEnergyKcal: number | null;
  /** Distance, metres, read from the quantity type the workout's *activity*
   *  records under — `distanceCycling` for a ride, `distanceSwimming` for a
   *  swim, `distanceWheelchair` for the wheelchair paces,
   *  `distanceDownhillSnowSports` for skiing and snowboarding, walking/running
   *  for everything else. `null` means no distance samples at all, which is
   *  what an indoor yoga session honestly looks like — not 0.
   *
   *  Rowing, paddling, cross-country skiing and skating record under types
   *  Apple introduced at watchOS 11, above this package's floor, so they read
   *  as walking/running and will usually be `null`. */
  distanceMeters: number | null;
}

/**
 * Shows the HealthKit permission sheet for the given read types (a silent
 * no-op re-prompt if they were already asked for), and reports **whether the
 * sheet was going to be shown** — `"prompted"`, `"alreadyRequested"`, or
 * `"unavailable"` when the device has no HealthKit.
 *
 * It does **not** report whether reading was granted: Apple does not tell an
 * app that, by design (see the module doc). The queries below also ensure
 * authorization for the type they read, so this exists mainly to run the sheet
 * at a moment you choose.
 */
export function requestHealthAuthorization(
  options: HealthAuthorizationOptions,
): Promise<HealthAuthorizationResult> {
  // The sheet blocks on the user, which routinely outlasts the 30 s default
  // watchdog — the same reason purchase() raises it.
  return invoke<HealthAuthorizationResult>(
    "requestHealthAuthorization",
    {
      read: options.read,
      ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
      ...(options.workoutHistory === undefined
        ? {}
        : { workoutHistory: options.workoutHistory }),
      ...(options.activitySummaries === undefined
        ? {}
        : { activitySummaries: options.activitySummaries }),
    },
    { timeoutMs: USER_MEDIATED_INVOKE_TIMEOUT_MS },
  );
}

/**
 * One aggregate (`HKStatisticsQueryDescriptor`) over `[startMs, endMs)` — e.g.
 * total steps today, or average heart rate during a run.
 *
 * Rejects `INVALID_REQUEST` when `statistic` is illegal for `type` (see
 * {@link HealthStatistic}) or the window is inverted. Resolves
 * `{ value: null }` when HealthKit has nothing to report — which, again, is
 * *not* distinguishable from a denied read.
 *
 * For a chart, use {@link queryHealthDailyStatistics} instead of calling this
 * once per day — it is one HealthKit query rather than seven.
 */
export function queryHealthStatistics(
  request: HealthStatisticsQuery,
): Promise<HealthStatisticsResult> {
  return invoke<HealthStatisticsResult>("queryHealthStatistics", request);
}

/**
 * The same aggregate, computed **once per day** across the window
 * (`HKStatisticsCollectionQueryDescriptor`) — "steps per day for the last
 * week" in one call.
 *
 * Prefer this over a loop of {@link queryHealthStatistics}: seven calls are
 * seven HealthKit query round trips, and on a watch that is a battery cost,
 * not a style preference. The request is identical, and each bucket is exactly
 * a {@link HealthStatisticsResult} over its own day — same `value`, same
 * `unit`, its own `startMs`/`endMs`.
 *
 * - **Buckets are contiguous, not sparse.** A day with no samples comes back
 *   as `value: null`, never as a missing entry, so `results.length` is the
 *   number of days you asked for and index *n* is day *n*.
 * - **A "day" starts at your `startMs`.** Buckets are anchored there and step
 *   one calendar day at a time, so pass local midnight (`d.setHours(0,0,0,0)`)
 *   to get the days a user would recognise — JS is where the time zone is.
 * - Rejects `INVALID_REQUEST` for the same illegal `statistic`/`type` pairing
 *   as the scalar query, and additionally when the window spans more than 1000
 *   days. That is a refusal rather than a truncation on purpose: a silently
 *   shortened series is a chart that lies about its range.
 *
 * `null` still means "denied, or no data, or outside the window you were
 * granted" — see the module doc.
 */
export function queryHealthDailyStatistics(
  request: HealthStatisticsQuery,
): Promise<HealthStatisticsResult[]> {
  return invoke<HealthStatisticsResult[]>(
    "queryHealthDailyStatistics",
    request,
  );
}

/**
 * Raw samples (`HKSampleQueryDescriptor`) in `[startMs, endMs)`, newest first.
 */
export function queryHealthSamples(
  request: HealthSamplesQuery,
): Promise<HealthSample[]> {
  return invoke<HealthSample[]>("queryHealthSamples", request);
}

/**
 * Sleep intervals in `[startMs, endMs)`, newest first. Needs
 * `requestHealthAuthorization({ read: [], sleep: true })` first — sleep is a
 * category type and can't ride the `read` list.
 */
export function querySleepSamples(
  request: SleepSamplesQuery,
): Promise<SleepSample[]> {
  return invoke<SleepSample[]>("querySleepSamples", request);
}

/**
 * The workouts already **saved** in `[startMs, endMs)`, newest first — a
 * "your last five runs" screen, as opposed to {@link getWorkoutState} (the
 * live one) or `listScheduledWorkoutPlans` (future ones).
 *
 * A workout matches when it **overlaps** the window — it ended at or after
 * `startMs` and started before `endMs` — which is HealthKit's default matching
 * and not the `[startMs, endMs)` rule the reads above describe. The difference
 * only shows up here, because only a workout is long enough for it to matter:
 * a hike that began at 23:10 and ended at 00:40 is in *both* days' lists, and
 * since rows sort by start time it lands last in the later one.
 *
 * Needs `requestHealthAuthorization({ read: [], workoutHistory: true })` first
 * — saved workouts are their own HealthKit object type and can't ride the
 * `read` list. That one flag asks for the energy and distance types too, not
 * just the workout: a workout's totals are computed from the samples recorded
 * *during* it, each of which is authorized on its own, so the sheet shows
 * those rows as well.
 *
 * The list includes workouts **other apps saved**, which is the whole point of
 * a history read and also why `activityType` can be missing: an activity this
 * package's vocabulary excludes is omitted rather than mislabelled.
 *
 * `activeEnergyKcal` and `distanceMeters` are `null` when the workout recorded
 * no samples of that kind — never `0` standing in for "didn't measure". Two
 * cases beyond "didn't measure" land there too: an app that saved only a
 * *total* with no per-sample data behind it (the un-deprecated read computes
 * these from the samples, so it cannot see such a total), and a type the user
 * declined in the sheet. An empty array still means "denied, or no data, or
 * outside the window you were granted"; see the module doc.
 */
export function queryWorkoutHistory(
  request: WorkoutHistoryQuery,
): Promise<WorkoutSummary[]> {
  return invoke<WorkoutSummary[]>("queryWorkoutHistory", request);
}

/**
 * The Activity **rings** for a range of days — move, exercise and stand, each
 * with the goal it is scored against, one row per day
 * (`HKActivitySummaryQueryDescriptor`).
 *
 * This is the read a rings screen is made of: three arcs are three value/goal
 * pairs, and the goals live nowhere else in HealthKit's read surface. It is
 * also what feeds a rings *complication*, but indirectly — every health read is
 * watch-app-only, so the **app** calls this and publishes the answer to the
 * widget timeline (`publishWidgets`); a complication that invoked it itself
 * would just get an error.
 *
 * **Days, not timestamps.** HealthKit identifies an activity summary by the
 * calendar day *as the user perceived it* — a day that, in Apple's own words,
 * "may be longer or shorter than 24 hours (for example, if the user traveled
 * across time zones)". No millisecond means that day on its own, so the request
 * and every row carry `"YYYY-MM-DD"` and nothing converts between the two. Both
 * ends are **inclusive**; `startDate === endDate` is a single day. A malformed
 * date, an `endDate` before `startDate`, or a range over 1000 days rejects
 * `INVALID_REQUEST` with a message naming the rule.
 *
 * **Producing a day string is the one thing to get right.** It must be the
 * user's *local* calendar day, so build it from the local getters:
 *
 * ```ts
 * const pad = (n: number) => String(n).padStart(2, "0");
 * const day = (d: Date) =>
 *   `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
 * ```
 *
 * **Not** `d.toISOString().slice(0, 10)`, the one-liner this shape invites:
 * that is UTC, so for part of every day it names a different day than the
 * user's watch is on. It is also the one form of the off-by-one nothing here
 * can refuse — a UTC day string is a perfectly valid day, just not the one the
 * caller meant.
 *
 * **A day with no summary is absent**, not a zero row: the user's watch was off
 * the wrist, or the day is in the future. Rows arrive **oldest day first**
 * (HealthKit promises no order, so the native side sorts), but a seven-day ask
 * can still resolve five rows — read {@link ActivitySummary.date}, never the
 * array index.
 *
 * Needs `requestHealthAuthorization({ read: [], activitySummaries: true })`
 * first. It asks for exactly one row in the sheet — unlike
 * {@link queryWorkoutHistory}, a summary is a single object HealthKit hands
 * over whole, so no quantity types ride along.
 *
 * An empty array still means "denied, or no data, or outside the window you
 * were granted"; see the module doc.
 */
export function queryActivitySummaries(
  request: ActivitySummariesQuery,
): Promise<ActivitySummary[]> {
  return invoke<ActivitySummary[]>("queryActivitySummaries", request);
}

/** The native-event name prefix a live stream's samples arrive on:
 *  `health.samples.<type>`, e.g. `health.samples.heartRate`.
 *
 *  Exported because it is an **unchecked string on both sides** — a JS constant
 *  here, a Swift literal in `HealthUpdatesPlan.eventPrefix` — and nothing
 *  compares them at compile time: a typo in either yields a subscription that
 *  never fires, with no error anywhere to say why. `health-package-guards.test`
 *  pins the two against each other, and it can only do that if the JS half is a
 *  named constant rather than an inline template string.
 *
 *  Exported from the package the way every other event name is
 *  (`SENSOR_EVENT_PREFIX`, `WORKOUT_METRICS_EVENT`), though a caller has little
 *  use for it: {@link startHealthUpdates} builds the name and narrows the
 *  payload, and a raw `registerNativeListener` on it gets neither. */
export const HEALTH_UPDATE_EVENT_PREFIX = "health.samples.";

/** One batch of samples that just landed in HealthKit, as
 *  {@link startHealthUpdates} delivers it. */
export interface HealthUpdate {
  /** The type these samples are for — the same value passed to
   *  {@link startHealthUpdates}, so one handler can serve two subscriptions. */
  type: HealthQuantityType;
  /**
   * The new samples, **oldest first** (sorted natively — HealthKit promises
   * `addedSamples` no order), each identical in shape and unit to a
   * {@link queryHealthSamples} row. Never empty: an update with nothing added
   * is not pushed at all — reach for {@link latest} rather than indexing, which
   * under this package's strictness needs a `!` the wrapper has already earned.
   *
   * **Additions only.** The anchored query also reports objects DELETED from
   * HealthKit, and this stream drops them: a wire row is `{startMs, endMs,
   * value, unit}` with no sample identity, so a subscriber could not tell which
   * of its rows a deletion retracted. A value the user then deletes in the
   * Health app is therefore not withdrawn here — re-read with
   * {@link queryHealthSamples} or {@link queryHealthStatistics} if that matters.
   */
  samples: HealthSample[];
  /**
   * The newest sample in this batch — `samples` is never empty, so this always
   * exists, which is the point: it is the whole answer for a "current heart
   * rate" screen without an index or a non-null assertion.
   *
   * For a "today's steps" screen it is **not** the answer: HealthKit stores
   * steps as many small samples, so the running total comes from
   * {@link queryHealthStatistics} and this stream is what tells you when to
   * re-read it.
   */
  latest: HealthSample;
}

/** Handler for {@link startHealthUpdates}. */
export type HealthUpdateHandler = (update: HealthUpdate) => void;

/** Options for {@link startHealthUpdates}. */
export interface HealthUpdateOptions {
  /**
   * Minimum gap between two pushes for this type, in ms. Default 1000, maximum
   * 60000 (a wider floor rejects `INVALID_REQUEST`).
   *
   * Not a sampling rate — HealthKit decides when a sample exists — and not a
   * filter: batches that arrive inside the floor are **held and merged**, so
   * they ride the next push together rather than the older one being dropped to
   * make room (which is what `workout.metrics` does, and can, because a metric
   * is level state). It is a **battery and render knob**: every push crosses the
   * bridge and commits a React render synchronously, so raising it really does
   * cut the number of pushes — N held batches cost one — at the price of up to
   * `minIntervalMs` of staleness.
   *
   * Only the **first** subscriber's value takes effect — the native stream is
   * shared, exactly like `startSensor`'s options.
   */
  minIntervalMs?: number;
}

/**
 * What {@link startHealthUpdates} returns: a cleanup, plus the promise the
 * fallible *start* settles on.
 *
 * Two members rather than one, because both halves are load-bearing and neither
 * can carry the other. A bare `Promise<Unsubscribe>` would make the React case
 * — the only case — an async dance whose cleanup can run before the promise
 * resolves; a bare `Unsubscribe` (the `startSensor` shape) would leave a failed
 * start with nowhere to go, which is the wart this API deliberately does not
 * repeat.
 */
export interface HealthUpdatesSubscription {
  /**
   * Settles when native has the query **armed** — or, if the app is in the
   * background, queued to arm on the next foreground (see the foreground-only
   * note on {@link startHealthUpdates}) — and rejects when it could not be:
   * `UNAVAILABLE` on a watch without HealthKit, `INVALID_REQUEST` for a bad
   * `minIntervalMs`. Awaiting it is optional — a rejection is also logged, so a
   * caller who ignores it still gets a diagnostic instead of a screen stuck on
   * "—" — but awaiting is what lets a UI say *why* there is no data.
   *
   * It does **not** report a denied read grant: HealthKit answers an
   * authorization request the same way whether the user allowed or refused, by
   * design, so a refused type is indistinguishable from one with no samples yet.
   *
   * A start that is cancelled by its own `stop()` before it finishes (React
   * StrictMode's mount/unmount/remount does this every time) **resolves**:
   * nothing failed, the subscriber simply left.
   */
  started: Promise<void>;
  /**
   * Drops this subscriber and, when it is the last one for the type, stops the
   * native query. Idempotent, and safe to call before {@link started} settles.
   */
  stop: Unsubscribe;
}

// Per-type set of live subscriber TOKENS and the shared start promise — the
// `startSensor` refcount verbatim, and for the same reason: one native query
// feeds every subscriber for a type, so it starts on the first and stops when
// the last leaves. A Set of identity tokens rather than a count is what makes a
// LATE cleanup safe — each cleanup removes only its own token, so one from
// before a stop/restart is not a member and does nothing, where a shared count
// would zero the new subscribers' stream.
const liveUpdates = new Map<
  HealthQuantityType,
  { tokens: Set<object>; started: Promise<void> }
>();

/** Test-only: clears the per-type subscriber state (not part of the public
 *  API), the `__resetSensorCountsForTest` counterpart. */
export function __resetHealthUpdatesForTest(): void {
  liveUpdates.clear();
}

/**
 * Live HealthKit updates for one quantity type: `handler` is called as new
 * samples land, so a screen showing today's steps or the current heart rate
 * updates itself instead of polling.
 *
 * ```ts
 * useEffect(
 *   () => startHealthUpdates("heartRate", (u) => setBpm(u.latest.value)).stop,
 *   [],
 * );
 * ```
 *
 * Backed by an `HKAnchoredObjectQueryDescriptor` (watchOS 8.5). Needs the type
 * in `requestHealthAuthorization({ read: [...] })` — and asks for it itself if
 * you did not, so a missing grant is a prompt rather than a stream that never
 * fires.
 *
 * **NEW samples only.** A subscriber gets what lands from *now on*, never a
 * backlog: history is {@link queryHealthSamples}'s job, and replaying it here
 * would hand a screen a thousand-row first push. A **second** subscriber to the
 * same type joins the running query and likewise sees the next sample, not the
 * last one — the event is edge-triggered, so nothing is replayed to a late
 * listener. Read the current value once with {@link queryHealthStatistics} and
 * let this keep it fresh.
 *
 * **Foreground only.** The query is stopped when the app backgrounds and
 * re-armed when it returns — this package ships no background-delivery
 * entitlement, so an armed query would deliver nothing while the app is away
 * and wake it for nothing when it came back. Samples saved while backgrounded
 * are **not** replayed on return, so re-read the number you display on the same
 * foreground.
 *
 * **Not a heart-rate monitor for a workout.** `startHeartRate` runs a real
 * `HKWorkoutSession` + `HKLiveWorkoutBuilder`: it samples at ~1 Hz, keeps the
 * app alive, and occupies the one workout slot watchOS allows a process. This
 * runs no session and needs no background mode; it reports heart-rate samples
 * as HealthKit saves them, which off a workout is every few minutes. During a
 * workout, reach for the session; on a screen showing today's numbers, reach
 * for this.
 *
 * Every subscriber gets its own subscription even when two pass the *same*
 * function: one call, one `stop`, one delivery.
 */
export function startHealthUpdates(
  type: HealthQuantityType,
  handler: HealthUpdateHandler,
  options?: HealthUpdateOptions,
): HealthUpdatesSubscription {
  const off = registerNativeListener(
    HEALTH_UPDATE_EVENT_PREFIX + type,
    (payload) => {
      // NARROWED here, so a handler is never handed the channel's raw
      // `Record<string, unknown>`. The key names are pinned natively (the
      // ARCH-11 producer scan), so a payload that fails this is a native bug,
      // not a caller error — and calling the handler with a non-array would
      // only move the crash into the screen's `.at(-1)`.
      const samples = payload?.samples;
      if (!Array.isArray(samples) || samples.length === 0) return;
      const rows = samples as HealthSample[];
      // `latest` is computed HERE, where non-emptiness has just been proved, so
      // the interface can promise a `HealthSample` rather than making every
      // caller re-prove it with a `!` or an index this package's
      // `noUncheckedIndexedAccess` would widen to `| undefined`.
      handler({
        type,
        samples: rows,
        latest: rows[rows.length - 1] as HealthSample,
      });
    },
  );
  const token = {};
  let entry = liveUpdates.get(type);
  if (!entry) {
    // First subscriber: it owns the start, and its options win (the native
    // query is shared). The promise is kept per type so a LATER subscriber
    // awaits the same settlement instead of believing a stream is live that
    // failed to arm.
    const started = invoke<void>(
      "startHealthUpdates",
      {
        type,
        ...(options?.minIntervalMs === undefined
          ? {}
          : { minIntervalMs: options.minIntervalMs }),
      },
      // The same watchdog `requestHealthAuthorization` uses, and for its reason:
      // native asks for the type it is about to read, so this start can be
      // sitting on the HealthKit authorization SHEET, which blocks on the user
      // and routinely outlasts the 30s default. Timing out there would reject a
      // start that then succeeds.
      { timeoutMs: USER_MEDIATED_INVOKE_TIMEOUT_MS },
    );
    entry = { tokens: new Set<object>(), started };
    liveUpdates.set(type, entry);
    started.catch((error) => {
      // A failed start leaves no subscriber able to stop the type — every token
      // holder's `stop()` finds no entry — so the state must go, and a stop must
      // go with it. Dropping the entry is what lets the NEXT subscriber retry
      // instead of listening forever to a stream that was never armed; sending
      // the stop is what covers the failures whose native side is AMBIGUOUS (a
      // timeout, a settle dropped by a reload's generation guard), where a query
      // may yet arm with nothing left in JS to take it down. Native never
      // refuses a stop for a stream that is not running, so the redundant case
      // costs one no-op invoke — and it cannot take down a retry's stream, since
      // it is sent before any later subscriber's start.
      if (liveUpdates.get(type) === entry) liveUpdates.delete(type);
      invoke<void>("stopHealthUpdates", { type }).catch(() => {});
      // Logged as well as rejected: `started` is optional to await, and a
      // silent failure here is a screen showing "—" with nothing to explain it.
      console.error(`startHealthUpdates("${type}") failed:`, error);
    });
  }
  entry.tokens.add(token);
  let cleaned = false;
  return {
    started: entry.started,
    stop: () => {
      // Idempotent: a double cleanup (React StrictMode) or one that outlived a
      // failed start must not send a spurious stop — the token is no longer a
      // member, so the guarded delete below does nothing.
      if (cleaned) return;
      cleaned = true;
      off();
      const current = liveUpdates.get(type);
      if (current?.tokens.delete(token) && current.tokens.size === 0) {
        liveUpdates.delete(type);
        // Fire-and-forget by design — this runs in an effect cleanup, where a
        // rejection has no caller left and would surface as an unhandled
        // rejection on a routine unmount. Native never refuses a stop for a
        // stream that is not running, so the only way here is a malformed type,
        // which is a bug worth a line rather than a throw.
        invoke<void>("stopHealthUpdates", { type }).catch((error) => {
          console.error(`stopHealthUpdates("${type}") failed:`, error);
        });
      }
    },
  };
}
