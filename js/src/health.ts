import type {
  HealthQuantityType,
  HealthStatisticsRequest,
  SleepSample as WireSleepSample,
  WorkoutActivityType,
} from "./generated/wire";
import { invoke, USER_MEDIATED_INVOKE_TIMEOUT_MS } from "./invoke";

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
 * are the watchOS 8.5 `HK*QueryDescriptor` family, and `HKWorkout.statistics(for:)`
 * (how {@link queryWorkoutHistory} reads energy and distance, since Apple
 * deprecated the `total*` properties) is 9.0 — well under this package's
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
