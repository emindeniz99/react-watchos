import type {
  HealthQuantityType,
  HealthStatisticsRequest,
  SleepSample as WireSleepSample,
} from "./generated/wire";
import { invoke, USER_MEDIATED_INVOKE_TIMEOUT_MS } from "./invoke";

/**
 * HealthKit **reads**: aggregate statistics, raw samples, and sleep stages.
 *
 * Separate from `startHeartRate` (a live push stream under the `sensors`
 * feature) and from `startWorkout` (a permanent write under `workouts`): these
 * four disclose the user's stored health *history*, which is its own
 * authorization unit — an app that wants live heart rate during a meditation
 * timer must be able to refuse sleep-history reads. Gated by the `health`
 * feature (ARCH-07).
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
 * Every symbol used natively is watchOS 8.5 or below — well under this
 * package's watchOS 10 floor — so nothing here is version-gated. HealthKit is
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
 * mutually exclusive per type, and the wrong pairing **throws** natively.
 * `"sum"` is legal only for a cumulative type (`stepCount`,
 * `activeEnergyBurned`, `distanceWalkingRunning`); `"average" | "min" | "max" |
 * "mostRecent"` only for a discrete one (`heartRate`, `oxygenSaturation`). An
 * illegal pairing rejects `INVALID_REQUEST` *before* the query runs.
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

/** One aggregate over a window. */
export interface HealthStatisticsResult {
  /** `null` when HealthKit returned no statistic for the window. Not
   *  distinguishable from a denied read — see the module doc. */
  value: number | null;
  /** The unit `value` is in, fixed natively per type: `"count"` (steps),
   *  `"kcal"`, `"m"`, `"count/min"` (bpm), `"fraction"` (SpO2, **0…1**, not
   *  0…100). Reported so a chart can label its axis. */
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
