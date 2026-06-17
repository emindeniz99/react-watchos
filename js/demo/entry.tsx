// QuickJS shims are prepended by esbuild's `inject` (scripts/config.mjs),
// so they run before react/scheduler module init regardless of import
// order here.
import { publishWidgets, runApp, startInspector } from "../src/index";
import { registerDemoWidgets } from "./widgets";
import { registerDemoIntents } from "./intents";
import { App } from "./App";

registerDemoWidgets();
registerDemoIntents();

// The widget extension evaluates this same bundle with
// __entrypoint = "intent" to handle controls: it then calls
// __handleIntent(name), whose handlers republish the timelines. Only the
// watch app mounts the UI.
const entrypoint =
  (globalThis as { __entrypoint?: string }).__entrypoint ?? "app";
if (entrypoint === "app") {
  runApp(<App />);
  // Seed the complications so they show data before any interaction.
  publishWidgets();
  // DEBUG-only: WatchApp sets __inspectorUrl so the tree + logs stream to
  // the `npm run inspector` viewer.
  const inspectorUrl = (globalThis as { __inspectorUrl?: string }).__inspectorUrl;
  if (inspectorUrl) startInspector({ url: inspectorUrl });
}
