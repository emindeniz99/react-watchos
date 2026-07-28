import { Storage } from "../src/index";

/**
 * Hydration state lives in App Group storage so it is shared by the app,
 * the widget timelines, and the "Add glass" control's intent handler
 * (which runs in the widget extension process).
 *
 * The counter is a CROSS-PROCESS-ATOMIC counter (ARCH-05), not a plain
 * get/set value: the app and the widget extension both increment it, and a
 * `get + 1 + set` over App Group UserDefaults loses concurrent updates (no
 * atomic cross-process read-modify-write). `Storage.counterAdd` does the whole
 * clamped add under a file-coordination claim instead.
 */
const KEY = "hydration.glasses";
const REMINDERS_KEY = "hydration.reminders";
const GOAL = 8;

export const hydrationStore = {
  goal: GOAL,

  get glasses(): number {
    return Storage.counterValue(KEY);
  },

  /**
   * Whether hydration reminders are on — the state behind the demo's
   * `ControlWidgetToggle`. A plain boolean, not a counter: unlike the glass
   * count, nothing does a read-modify-write on it (both writers set an
   * absolute value), so there is no lost-update race to defend against.
   */
  get remindersEnabled(): boolean {
    return Storage.get<boolean>(REMINDERS_KEY) ?? false;
  },

  setRemindersEnabled(enabled: boolean): void {
    Storage.set(REMINDERS_KEY, enabled);
  },

  /**
   * Atomically add `delta` glasses, clamped to [0, goal]; returns the new total.
   * Used by both the app's "Add glass" button and the widget extension's
   * `addGlass` control — the two processes that race on this counter. Reset is a
   * delta that underflows the floor (e.g. `-goal`).
   */
  addGlasses(delta: number): number {
    return Storage.counterAdd(KEY, delta, 0, this.goal);
  },
};
