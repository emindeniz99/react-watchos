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
    hydrationStore.glasses += 1;
  });
}
