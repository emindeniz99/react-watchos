import { Storage } from "../src/index";

/**
 * Hydration state lives in App Group storage so it is shared by the app,
 * the widget timelines, and the "Add glass" control's intent handler
 * (which runs in the widget extension process).
 */
const KEY = "hydration.glasses";

export const hydrationStore = {
  goal: 8,

  get glasses(): number {
    return Storage.get<number>(KEY) ?? 0;
  },

  set glasses(value: number) {
    Storage.set(KEY, Math.max(0, Math.min(this.goal, value)));
  },
};
