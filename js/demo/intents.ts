import { registerIntent } from "../src/index";
import { hydrationStore } from "./hydrationStore";

/**
 * Handler behind the "Add Glass" WidgetKit control: runs in the widget
 * extension's QuickJS and mutates shared storage. The runtime republishes
 * every timeline automatically (the storage write is the reload signal), so
 * the complications update without the app ever opening — the handler doesn't
 * call publishWidgets() itself.
 */
export function registerDemoIntents(): void {
  registerIntent("addGlass", () => {
    // Atomic cross-process add (ARCH-05): the app may be incrementing the same
    // counter; a plain get+set here would lose one of the two updates.
    hydrationStore.addGlasses(1);
  });

  // The "Hydration Reminders" ControlWidgetToggle. One handler PER DIRECTION,
  // each writing an absolute value, rather than one handler that flips: the
  // OS hands its `SetValueIntent` the value the user asked for, and
  // `WidgetIntentRuntime.handle(intent:appGroupId:)` carries an intent NAME but
  // no parameters — so encoding the direction in the name is what preserves it.
  // A flip would instead re-derive the new state from our own last-published
  // `value`, which is right only while that payload is current and sticks
  // permanently if it ever isn't. (Follow-up if a consumer needs richer
  // arguments: a params-carrying `handle` overload — JS's `handleIntent`
  // already accepts a `paramsJson`; only the Swift side is missing.)
  registerIntent("remindersOn", () => {
    hydrationStore.setRemindersEnabled(true);
  });
  registerIntent("remindersOff", () => {
    hydrationStore.setRemindersEnabled(false);
  });
}
