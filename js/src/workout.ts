import type {
  WorkoutState as WireWorkoutState,
  WorkoutActivityType,
} from "./generated/wire";
import { invoke } from "./invoke";
import {
  type NativeEventHandler,
  registerNativeListener,
  type Unsubscribe,
} from "./nativeEvents";

/**
 * Real workout control: start a named `HKWorkoutSession`, pause/resume it, and
 * end it with a permanent `HKWorkout` saved into the user's health record
 * (where it surfaces in Fitness and the Activity rings).
 *
 * Gated by the `workouts` feature, separate from `health` (reads) and `sensors`
 * (the live heart-rate stream), because it is a different authorization
 * decision: a write + background execution + the ONE workout slot watchOS
 * allows a process.
 *
 * ### The single-session rule
 *
 * Apple: *"Apple Watch runs one workout session at a time. If a second workout
 * starts while your workout is running, your session receives an error, and
 * your session ends."* `startHeartRate` has always used a hidden session as a
 * heart-rate pump, so native owns exactly one and both APIs claim it:
 *
 * - `startWorkout` while `startHeartRate` is subscribed **upgrades** the
 *   session in place. Your `sensor.heartRate` subscription keeps firing, with a
 *   one-transition gap while the session is swapped.
 * - `endWorkout` while `startHeartRate` is still subscribed **downgrades** back
 *   to the pump — deferred to the next foreground if the app is backgrounded
 *   and the subscription did not ask for `keepAliveInBackground`.
 * - `startWorkout` while a workout is already running rejects `UNAVAILABLE`
 *   immediately — it does not stack, and it does not kill the running one.
 * - `endWorkout` while a `startWorkout` is still in flight **cancels** it: no
 *   session is ever created, the pending `startWorkout` rejects, and the
 *   `endWorkout` resolves.
 *
 * The pump is invisible to this API in both directions. {@link WORKOUT_STATE_EVENT}
 * and {@link getWorkoutState} describe the **explicit** session only, so a plain
 * `stopHeartRate()` never looks like a workout ending.
 *
 * ### Background execution
 *
 * A running workout keeps the app alive (that is what makes the running-workout
 * chip appear on the watch face) — but only if the app declares the
 * `workout-processing` background mode. The config plugin emits it from the
 * `workouts: true` option; without that, the session ends when the app
 * backgrounds.
 *
 * ### Reloads
 *
 * A workout does **not** survive a JS runtime reload (dev hot-reload, OTA
 * apply) in v1. The native side ends and **saves** it deterministically and
 * parks the summary; the fresh runtime reads it from its first
 * {@link getWorkoutState} with `endedReason: "runtimeReload"`.
 */

/** `workout.state`: `{ state, reason? }` on every session transition. */
export const WORKOUT_STATE_EVENT = "workout.state";
/** `workout.metrics`: coalesced live metrics while a workout runs. */
export const WORKOUT_METRICS_EVENT = "workout.metrics";

/** Every live `HKWorkoutActivityType`. Re-exported from the generated wire
 *  module: the same schema list renders the Swift name→case switch, so a hand
 *  copy here could name an activity native can't map. */
export type { WorkoutActivityType };

/** The live session's state, plus the last one that ended. */
export type WorkoutState = WireWorkoutState;

/** Options for {@link startWorkout}. */
export interface StartWorkoutOptions {
  /** Indoor or outdoor. Not cosmetic: Apple states outdoor cycling generates
   *  accurate location data where indoor does not, and that calorimetry
   *  differs by location — it changes the numbers the workout records. */
  location?: "indoor" | "outdoor";
  /**
   * How often `workout.metrics` is pushed, in ms. Default 1000, floor 250.
   * HealthKit collects samples at ~1 Hz and every push crosses the bridge and
   * can commit a render, so raise this as far as the UI tolerates — it is a
   * direct battery knob, like `startMotion`'s `updateIntervalMs`.
   */
  metricsIntervalMs?: number;
  /**
   * Record an `HKWorkoutRoute` from the location stream. Needs the `location`
   * feature **as well as** `workouts` (a route is location data), and rejects
   * `POLICY_DENIED` naming `location` if the app's host policy withholds it.
   * The route rides the same `CLLocationManager` `startLocation` uses — no
   * second GPS stream — and is finished after the workout is saved.
   */
  collectRoute?: boolean;
}

/** Live metrics payload on {@link WORKOUT_METRICS_EVENT}. Each optional field
 *  is absent until HealthKit has collected that quantity for this workout. */
export interface WorkoutMetrics {
  elapsedMs: number;
  heartRateBpm?: number;
  activeEnergyKcal?: number;
  /** Distance in metres, from the quantity type matching the activity
   *  (cycling and swimming record under their own types).
   *
   *  There is deliberately no `pace`: HealthKit exposes no workout pace
   *  quantity, so it would only ever be `distance / elapsed`, which the caller
   *  can compute. For real pace and cadence use `startPedometer`. */
  distanceMeters?: number;
}

/**
 * Starts a workout. Resolves when the session is actually **running** — the
 * invoke is parked on `HKWorkoutSession`'s delegate, not settled when the
 * request is submitted.
 *
 * Rejects `UNAVAILABLE` when a workout is already running, the activity name
 * isn't a known `HKWorkoutActivityType`, or the watch has no HealthKit; and
 * `UNAVAILABLE` with the system's reason if the session ends before it starts
 * (which is what another app starting a workout looks like).
 *
 * Requests its own share authorization as part of starting — that is what a
 * real workout app does, and it keeps one feature per method.
 */
export function startWorkout(
  activityType: WorkoutActivityType,
  options?: StartWorkoutOptions,
): Promise<void> {
  return invoke("startWorkout", {
    activityType,
    ...(options?.location === undefined ? {} : { location: options.location }),
    ...(options?.metricsIntervalMs === undefined
      ? {}
      : { metricsIntervalMs: options.metricsIntervalMs }),
    ...(options?.collectRoute === undefined
      ? {}
      : { collectRoute: options.collectRoute }),
  });
}

/** Pauses the running workout. Rejects `UNAVAILABLE` if none is running —
 *  "nothing to pause" is a refusal, not a silent success. */
export function pauseWorkout(): Promise<void> {
  return invoke("pauseWorkout");
}

/** Resumes a paused workout. Rejects `UNAVAILABLE` if none is paused. */
export function resumeWorkout(): Promise<void> {
  return invoke("resumeWorkout");
}

/**
 * Ends the workout and, by default, **saves** it as an `HKWorkout` — resolving
 * with the same snapshot {@link getWorkoutState} reports, so the saved id,
 * duration, energy and distance arrive without a second round trip.
 *
 * `discard: true` throws it away instead. Apple's HIG requires an app to either
 * save automatically or offer an explicit save/discard choice; saving is the
 * default because it is the half that cannot lose the user's data.
 *
 * Also **cancels** a {@link startWorkout} that has not finished starting — the
 * HealthKit authorization round trip is a real window, and an effect cleanup
 * that unmounts mid-start lands in it. That call resolves (with a `notStarted`
 * snapshot, since nothing ran and nothing was saved) and the pending
 * `startWorkout` rejects `UNAVAILABLE`. Rejects `UNAVAILABLE` only when there
 * is genuinely nothing to end.
 */
export function endWorkout(options?: {
  discard?: boolean;
}): Promise<WorkoutState> {
  return invoke<WorkoutState>("endWorkout", {
    discard: options?.discard ?? false,
  });
}

/**
 * The live session's state — and the last workout that ended, which is how a
 * workout ended by a runtime reload reaches the runtime that never started it
 * (`endedReason: "runtimeReload"`). The `ended*` fields persist until another
 * workout ends, so a screen can render "last workout" at any time.
 */
export function getWorkoutState(): Promise<WorkoutState> {
  return invoke<WorkoutState>("getWorkoutState");
}

/** Session transitions: handler gets `{ state, reason? }`. */
export function onWorkoutState(handler: NativeEventHandler): Unsubscribe {
  return registerNativeListener(WORKOUT_STATE_EVENT, handler);
}

/** Live metrics while a workout runs: handler gets a {@link WorkoutMetrics}. */
export function onWorkoutMetrics(handler: NativeEventHandler): Unsubscribe {
  return registerNativeListener(WORKOUT_METRICS_EVENT, handler);
}
