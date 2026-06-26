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
}
