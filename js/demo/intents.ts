import { publishWidgets, registerIntent } from "../src/index";
import { hydrationStore } from "./hydrationStore";

/**
 * Handler behind the "Add Glass" WidgetKit control: runs in the widget
 * extension's QuickJS, mutates shared storage, and republishes every
 * timeline so the complications update without the app ever opening.
 */
export function registerDemoIntents(): void {
  registerIntent("addGlass", () => {
    hydrationStore.glasses += 1;
    publishWidgets();
  });
}
