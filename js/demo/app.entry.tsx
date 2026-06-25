// QuickJS shims are prepended by esbuild's `inject` (scripts/config.mjs),
// so they run before react/scheduler module init regardless of import
// order here.
//
// The WATCH APP bundle (ARCH-03): mounts the UI and seeds/syncs the
// complications. The widget extension gets its own, smaller bundle
// (widget.entry.tsx) that never imports App, so it no longer evaluates app
// code just to handle intents.
import { publishWidgets, runApp, startInspector } from "../src/index";
import { App } from "./App";
import { registerDemoIntents } from "./intents";
import { subscribeShopping } from "./shoppingStore";
import { registerDemoWidgets } from "./widgets";

registerDemoWidgets();
registerDemoIntents();

runApp(<App />);
// Seed the complications so they show data before any interaction.
publishWidgets();
// Keep the shopping complication in sync with in-app edits (add/toggle/
// feature). publishWidgets re-renders all timelines and triggers a native
// WidgetCenter reload, so trailing-debounce it: a burst of rapid edits
// (e.g. checking off several items) republishes once after it settles
// rather than on every mutation.
let republishTimer: ReturnType<typeof setTimeout> | undefined;
subscribeShopping(() => {
  if (republishTimer !== undefined) clearTimeout(republishTimer);
  republishTimer = setTimeout(() => {
    republishTimer = undefined;
    publishWidgets();
  }, 200);
});
// DEBUG-only: WatchApp sets __inspectorUrl so the tree + logs stream to
// the `npm run inspector` viewer.
const inspectorUrl = (globalThis as { __inspectorUrl?: string }).__inspectorUrl;
if (inspectorUrl) startInspector({ url: inspectorUrl });
