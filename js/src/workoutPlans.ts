import type {
  WorkoutPlanAlertRequest,
  WorkoutPlanGoalRequest,
  WorkoutPlanRequest,
  WorkoutPlanStepRequest,
} from "./generated/wire";
import { invoke, USER_MEDIATED_INVOKE_TIMEOUT_MS } from "./invoke";
import type { WorkoutActivityType } from "./workout";

/**
 * **WorkoutKit plans**: compose a structured workout, hand it to Apple's
 * Workout app, and schedule it there.
 *
 * Separate from {@link startWorkout} (feature `workouts`) in every way that
 * matters, which is why it is its own `workoutPlans` feature (ARCH-07):
 *
 * | | `workouts` | `workoutPlans` |
 * |---|---|---|
 * | writes | a permanent `HKWorkout` into the health record | a scheduled *document* |
 * | system resource | the ONE `HKWorkoutSession` slot | none |
 * | background execution | yes | none |
 * | OS consent | HealthKit share authorization | **its own** |
 *
 * A training-plan app that composes and hands off plans needs zero live-session
 * capability; a meditation timer that records a workout needs zero scheduling.
 * Neither implies the other, and each has its own independently-grantable
 * consent — so an app can allow one and refuse the other.
 *
 * ### Authorization here is honest, unlike HealthKit reads
 *
 * {@link requestWorkoutPlanAuthorization} resolves a **real verdict**
 * (`"authorized" | "denied" | "notDetermined" | "restricted"`), because
 * `WorkoutScheduler.requestAuthorization()` returns one. This is deliberately
 * *not* the shape `requestHealthAuthorization` has: Apple states an app
 * "doesn't know whether someone granted or denied permission to read data",
 * so that one can only report whether the sheet was going to be shown. The two
 * differ because the frameworks differ, not because this file is inconsistent.
 *
 * ### Units are fixed, and named in the field
 *
 * `meters`, `seconds`, `kilocalories`, `lowerBpm`, `countPerMinute`, `watts`,
 * `metersPerSecond`. No unit string crosses the wire — that would be a drift
 * surface with no gate. Note that Apple's alert API is **speed**
 * (`UnitSpeed`), even though WWDC and every consumer app calls it "pace";
 * {@link paceToMetersPerSecond} converts for a runner who thinks in min/km.
 *
 * ### Everything a watch app can verify, it verifies
 *
 * `WorkoutScheduler`'s mutating calls (`schedule`, `remove`,
 * `removeAllWorkouts`) are non-throwing and return nothing — they resolve
 * identically whether the plan was stored, the user denied authorization, or
 * the device is over quota. So each one here is **read back** natively before
 * the promise settles: `scheduleWorkoutPlan` re-reads the scheduler and
 * confirms the `(id, minute)` pair, and rejects `UNAVAILABLE` if the scheduler
 * accepted nothing.
 *
 * **Status:** `openWorkoutPlanInWorkoutApp` is the confirmed watch-native half.
 * The scheduling family is documented watchOS 10.0 with no caveat, but Apple's
 * own sample schedules from iPhone and only *reads* on the watch — nothing
 * contradicts watch-side scheduling and nothing confirms it either, so it is
 * **device-unverified** (③ in docs/status.md). The read-back is what makes
 * that honest at runtime rather than hopeful.
 *
 * Every symbol used natively is watchOS 10.0 — this package's floor — so
 * nothing here is version-gated.
 */

/** The workout activity, reused verbatim from the live-session vocabulary:
 *  WorkoutKit takes an `HKWorkoutActivityType` too, and the generated name →
 *  case switch already covers all 81 live members. */
export type { WorkoutActivityType };

/**
 * What a step (or a single-goal workout) is trying to reach.
 *
 * `energy` is legal **only** on a `singleGoal` plan — Apple's
 * `CustomWorkout.supportsGoal(.energy, …)` returns false for every activity and
 * location, by design. A custom workout asking for one rejects
 * `INVALID_REQUEST` naming that.
 */
export type WorkoutPlanGoal =
  | { kind: "open" }
  | { kind: "distance"; meters: number }
  | { kind: "time"; seconds: number }
  | { kind: "energy"; kilocalories: number };

/**
 * The in-workout alert a step fires on. **One per step** — Apple's
 * `WorkoutStep.alert` is a single optional, not an array.
 *
 * Two things worth knowing before shipping one:
 *
 * - **Which alerts are legal depends on the activity *and* the location, and
 *   Apple documents the matrix nowhere.** Indoor running, for instance, permits
 *   heart-rate targets but not pace. Every alert is checked natively with
 *   `CustomWorkout.supportsAlert` before the plan is built, so an illegal one
 *   rejects `INVALID_REQUEST` naming the path
 *   (`plan.blocks[2].steps[0].alert: …`) instead of silently vanishing.
 * - **Alerts fire more often than users expect.** For cycling power in
 *   particular the watch averages over ~3 seconds, so a rider holding target
 *   still gets warnings every 10–15 s. That is Apple's behavior, not this
 *   library's — budget for it in your UI copy.
 *
 * `metric` (current vs average) is available on the **speed** alerts only:
 * Apple takes it at watchOS 10.0 there and at 10.4 for power, and this package
 * is deliberately `@available`-free.
 */
export type WorkoutPlanAlert =
  | { kind: "heartRateRange"; lowerBpm: number; upperBpm: number }
  | { kind: "heartRateZone"; zone: number }
  | {
      kind: "speedRange";
      lowerMetersPerSecond: number;
      upperMetersPerSecond: number;
      metric?: "current" | "average";
    }
  | {
      kind: "speedThreshold";
      metersPerSecond: number;
      metric?: "current" | "average";
    }
  | {
      kind: "cadenceRange";
      lowerCountPerMinute: number;
      upperCountPerMinute: number;
    }
  | { kind: "cadenceThreshold"; countPerMinute: number }
  | { kind: "powerRange"; lowerWatts: number; upperWatts: number }
  | { kind: "powerThreshold"; watts: number }
  | { kind: "powerZone"; zone: number };

/** A warmup / cooldown step: an optional goal and at most one alert. */
export interface WorkoutPlanStep {
  /** Omitted means Apple's `.open` — run until the user taps next. */
  goal?: WorkoutPlanGoal;
  alert?: WorkoutPlanAlert;
}

/** A step inside an interval block, which additionally says what it is for. */
export interface WorkoutPlanIntervalStep extends WorkoutPlanStep {
  purpose: "work" | "recovery";
}

/** One repeated group of work/recovery steps. */
export interface WorkoutPlanBlock {
  /** At least one. */
  steps: WorkoutPlanIntervalStep[];
  /** How many times the block repeats; default 1. */
  iterations?: number;
}

/** The fields every plan kind carries, whatever its `kind`. Exported because
 *  every arm of {@link WorkoutPlanSpec} extends it, so a consumer writing
 *  `function label(plan: WorkoutPlanCommon)` should not have to restate it. */
export interface WorkoutPlanCommon {
  /**
   * A **UUID**, and the identity `scheduleWorkoutPlan` /
   * `removeScheduledWorkoutPlan` / `listScheduledWorkoutPlans` all key on.
   * Omit it and native mints one, reported back in the summary. A non-UUID
   * string rejects `INVALID_REQUEST` rather than being silently replaced —
   * a substitution would make removal a no-op you could never see.
   */
  id?: string;
  activityType: WorkoutActivityType;
  /** Omitted maps to WorkoutKit's own "unknown" default. */
  location?: "indoor" | "outdoor";
}

/**
 * A workout composition. Three kinds, matching the three WorkoutKit types this
 * package builds:
 *
 * - `custom` — interval blocks, optional warmup/cooldown. The reason to use
 *   WorkoutKit at all; needs **at least one block** (an unstructured plan is a
 *   `singleGoal`).
 * - `singleGoal` — one goal, no structure. The only kind where an `energy`
 *   goal is legal.
 * - `pacer` — "5 km in 25:00": a distance and the time to cover it in.
 *
 * Multisport (`SwimBikeRunWorkout`) is deliberately not built — no surveyed
 * consumer ships it, and adding it is one more `kind`, additive.
 */
export type WorkoutPlanSpec =
  | (WorkoutPlanCommon & {
      kind: "custom";
      /** Shown in the Workout app. Custom workouts only. */
      displayName?: string;
      warmup?: WorkoutPlanStep;
      blocks: WorkoutPlanBlock[];
      cooldown?: WorkoutPlanStep;
    })
  | (WorkoutPlanCommon & { kind: "singleGoal"; goal: WorkoutPlanGoal })
  | (WorkoutPlanCommon & {
      kind: "pacer";
      distanceMeters: number;
      durationSeconds: number;
    });

/** One plan the Workout app is holding. */
export interface ScheduledWorkoutSummary {
  /** The plan's UUID — the one you passed, or the one native minted. */
  id: string;
  /**
   * When it is scheduled, ms since epoch. **Minute granularity**: the
   * scheduler keys on year/month/day/hour/minute, so a plan scheduled at
   * `…:30.500` lists as `…:30.000`.
   */
  atMs: number;
  /** Set by the **Workout app** when the user finishes it. Nothing in this API
   *  writes it — reading it is how you learn a plan was done. */
  complete: boolean;
  /** Absent when this binary's vocabulary has no name for the stored activity
   *  — omitted rather than reported as the wrong workout. */
  activityType?: WorkoutActivityType;
}

/** The verdict {@link requestWorkoutPlanAuthorization} resolves —
 *  `WorkoutScheduler.AuthorizationState`, and a real one. */
export type WorkoutPlanAuthorizationState =
  | "authorized"
  | "denied"
  | "notDetermined"
  | "restricted";

/**
 * Converts a running **pace** (minutes per kilometer) to the **speed**
 * (meters per second) the alert fields take.
 *
 * This exists because the two are reciprocals and getting it backwards is
 * silent: `paceToMetersPerSecond(5)` — a 5:00/km pace — is `3.33` m/s, and an
 * alert built from `5` directly would target a 3-minute kilometer instead. The
 * wire says `metersPerSecond` for exactly that reason; Apple's API is
 * `UnitSpeed` even where the UI says "pace".
 *
 * ```ts
 * { kind: "speedThreshold", metersPerSecond: paceToMetersPerSecond(5) }
 * ```
 */
export function paceToMetersPerSecond(minutesPerKilometer: number): number {
  return 1000 / (minutesPerKilometer * 60);
}

/** ms since epoch from either spelling, the `scheduleNotification` convention. */
function atMs(at: number | Date): number {
  return typeof at === "number" ? at : at.getTime();
}

function goalToWire(goal: WorkoutPlanGoal): WorkoutPlanGoalRequest {
  switch (goal.kind) {
    case "distance":
      return { kind: "distance", meters: goal.meters };
    case "time":
      return { kind: "time", seconds: goal.seconds };
    case "energy":
      return { kind: "energy", kilocalories: goal.kilocalories };
    default:
      return { kind: "open" };
  }
}

/**
 * Narrows the discriminated union onto the FLAT wire struct. Flat is not an
 * accident: the codegen emits `public let` Codable structs, so a Swift
 * enum-with-payload is not expressible — and flat is also what makes every
 * deferred variant additive, so adding one never invalidates a shipped fixture.
 * Each arm sends only its own fields; native rejects a field belonging to
 * another `kind` rather than ignoring it.
 */
function alertToWire(alert: WorkoutPlanAlert): WorkoutPlanAlertRequest {
  switch (alert.kind) {
    case "heartRateRange":
      return {
        kind: "heartRateRange",
        lowerBpm: alert.lowerBpm,
        upperBpm: alert.upperBpm,
      };
    case "heartRateZone":
      return { kind: "heartRateZone", zone: alert.zone };
    case "speedRange":
      return {
        kind: "speedRange",
        lowerMetersPerSecond: alert.lowerMetersPerSecond,
        upperMetersPerSecond: alert.upperMetersPerSecond,
        ...(alert.metric === undefined ? {} : { metric: alert.metric }),
      };
    case "speedThreshold":
      return {
        kind: "speedThreshold",
        metersPerSecond: alert.metersPerSecond,
        ...(alert.metric === undefined ? {} : { metric: alert.metric }),
      };
    case "cadenceRange":
      return {
        kind: "cadenceRange",
        lowerCountPerMinute: alert.lowerCountPerMinute,
        upperCountPerMinute: alert.upperCountPerMinute,
      };
    case "cadenceThreshold":
      return { kind: "cadenceThreshold", countPerMinute: alert.countPerMinute };
    case "powerRange":
      return {
        kind: "powerRange",
        lowerWatts: alert.lowerWatts,
        upperWatts: alert.upperWatts,
      };
    case "powerThreshold":
      return { kind: "powerThreshold", watts: alert.watts };
    default:
      return { kind: "powerZone", zone: alert.zone };
  }
}

function stepToWire(
  step: WorkoutPlanStep,
  purpose?: "work" | "recovery",
): WorkoutPlanStepRequest {
  return {
    ...(purpose === undefined ? {} : { purpose }),
    ...(step.goal === undefined ? {} : { goal: goalToWire(step.goal) }),
    ...(step.alert === undefined ? {} : { alert: alertToWire(step.alert) }),
  };
}

function planToWire(plan: WorkoutPlanSpec): WorkoutPlanRequest {
  const common = {
    activityType: plan.activityType,
    ...(plan.id === undefined ? {} : { id: plan.id }),
    ...(plan.location === undefined ? {} : { location: plan.location }),
  };
  switch (plan.kind) {
    case "singleGoal":
      return { kind: "singleGoal", ...common, goal: goalToWire(plan.goal) };
    case "pacer":
      return {
        kind: "pacer",
        ...common,
        distanceMeters: plan.distanceMeters,
        durationSeconds: plan.durationSeconds,
      };
    default:
      return {
        kind: "custom",
        ...common,
        ...(plan.displayName === undefined
          ? {}
          : { displayName: plan.displayName }),
        ...(plan.warmup === undefined
          ? {}
          : { warmup: stepToWire(plan.warmup) }),
        blocks: plan.blocks.map((block) => ({
          steps: block.steps.map((step) => stepToWire(step, step.purpose)),
          ...(block.iterations === undefined
            ? {}
            : { iterations: block.iterations }),
        })),
        ...(plan.cooldown === undefined
          ? {}
          : { cooldown: stepToWire(plan.cooldown) }),
      };
  }
}

/**
 * Shows the WorkoutKit scheduling permission sheet and resolves the resulting
 * `AuthorizationState`.
 *
 * Native reads the standing state **first** and prompts only when it is
 * `"notDetermined"`, so calling this again returns the current status without
 * re-prompting — the same contract {@link requestCalendarAccess} documents.
 * (Apple does not document whether `requestAuthorization()` re-prompts on its
 * own; this makes the contract true by construction rather than by assumption.)
 *
 * Rejects `UNAVAILABLE` on a device where `WorkoutScheduler.isSupported` is
 * false.
 */
export function requestWorkoutPlanAuthorization(): Promise<WorkoutPlanAuthorizationState> {
  // The sheet blocks on the user, which routinely outlasts the 30 s default.
  return invoke<WorkoutPlanAuthorizationState>(
    "requestWorkoutPlanAuthorization",
    undefined,
    { timeoutMs: USER_MEDIATED_INVOKE_TIMEOUT_MS },
  );
}

/**
 * Schedules `plan` at `at` and resolves the summary the scheduler actually
 * holds — **read back after writing**, never assumed.
 *
 * - The instant is truncated to the **minute** (WorkoutKit keys on
 *   year/month/day/hour/minute), which is what makes
 *   {@link removeScheduledWorkoutPlan} match by construction.
 * - The device's own quota (`maxAllowedScheduledWorkoutCount`, read at
 *   runtime — never a hardcoded 15) is checked first; over it, this rejects
 *   `INVALID_REQUEST` naming the numbers.
 * - Every goal and alert is put through Apple's `supports*` checks before the
 *   plan is built, so an illegal combination rejects `INVALID_REQUEST` naming
 *   the failing path.
 * - If the scheduler stores nothing, this rejects `UNAVAILABLE` saying so
 *   rather than resolving a success that did not happen.
 *
 * The user sees a scheduled plan at the top of the Workout app on the day it
 * is due (Apple shows a ±7-day window).
 */
export function scheduleWorkoutPlan(
  plan: WorkoutPlanSpec,
  at: number | Date,
): Promise<ScheduledWorkoutSummary> {
  return invoke<ScheduledWorkoutSummary>("scheduleWorkoutPlan", {
    plan: planToWire(plan),
    atMs: atMs(at),
  });
}

/**
 * Every plan the scheduler is holding, including ones scheduled by an earlier
 * launch. `complete` is the read that tells you the user finished one — the
 * Workout app sets it, and nothing in this API writes it.
 */
export function listScheduledWorkoutPlans(): Promise<
  ScheduledWorkoutSummary[]
> {
  return invoke<ScheduledWorkoutSummary[]>("listScheduledWorkoutPlans");
}

/**
 * Removes one scheduled plan by the `(id, at)` pair it was scheduled with, and
 * resolves **whether it was there**.
 *
 * An id that isn't scheduled resolves `false` rather than rejecting: a stale UI
 * removing an already-completed plan is normal, not an error. A malformed
 * (non-UUID) id still rejects `INVALID_REQUEST`. Native resolves the real plan
 * object out of the scheduler, so you never re-send a whole composition to
 * delete one, and the removal is read back before it settles.
 */
export function removeScheduledWorkoutPlan(
  id: string,
  at: number | Date,
): Promise<boolean> {
  return invoke<boolean>("removeScheduledWorkoutPlan", {
    id,
    atMs: atMs(at),
  });
}

/** Clears the scheduler — the only recovery from a list you can no longer
 *  address, and read back like the other mutations. */
export function removeAllScheduledWorkoutPlans(): Promise<void> {
  return invoke<void>("removeAllScheduledWorkoutPlans");
}

/**
 * Hands `plan` to the Workout app (`WorkoutPlan.openInWorkoutApp()`), which on
 * watchOS **launches it** — your app leaves the foreground.
 *
 * Resolving means the Workout app was handed the plan. It does **not** mean the
 * user started it, and Apple does not document when the call returns, so this
 * uses the user-mediated watchdog. Do not treat resolution as a workout
 * beginning — use {@link onWorkoutState} for that, which describes an
 * `HKWorkoutSession` your app owns.
 *
 * This is the one API in this module that is watchOS-native beyond doubt (it
 * does not exist on iOS at all), and it needs no scheduling authorization.
 */
export function openWorkoutPlanInWorkoutApp(
  plan: WorkoutPlanSpec,
): Promise<void> {
  return invoke<void>(
    "openWorkoutPlanInWorkoutApp",
    { plan: planToWire(plan) },
    { timeoutMs: USER_MEDIATED_INVOKE_TIMEOUT_MS },
  );
}
