// QuickJS shims are prepended by esbuild's `inject` (scripts/config.ts),
// so they run before react/scheduler module init regardless of import
// order here.
//
// The WATCH APP bundle (ARCH-03): mounts the UI and seeds/syncs the
// complications. The widget extension gets its own, smaller bundle
// (widget.entry.tsx) that never imports App, so it no longer evaluates app
// code just to handle intents.
import {
  onDiagnostic,
  publishWidgets,
  runApp,
  startInspector,
} from "../src/index";
import { App } from "./App";
import { registerDemoIntents } from "./intents";
import { subscribeShopping } from "./shoppingStore";
import { registerDemoWidgets } from "./widgets";

registerDemoWidgets();
registerDemoIntents();

// ARCH-13: the host reports every structured error/notice it records (OTA
// rollback, wire decode failure, budget breach, capability/policy denial) into
// JS. Subscribed BEFORE runApp so a diagnostic raised during the first mount
// isn't missed. A real app forwards these to its telemetry; the demo logs
// them, which routes to the inspector when one is attached.
onDiagnostic((d) => {
  console.log(
    `[diagnostic] ${d.severity} ${d.subsystem}.${d.code} (${d.target})` +
      (d.details ? `: ${d.details}` : ""),
  );
});

runApp(<App />);
// Seed the complications so they show data before any interaction.
publishWidgets();
// Keep the shopping complication in sync with in-app edits (add/toggle/
// feature). publishWidgets re-renders EVERY registered timeline and persists
// the payload, so trailing-debounce it: a burst of rapid edits (e.g. checking
// off several items) republishes once after it settles rather than on every
// mutation. (The native WidgetCenter reload behind it is separately gated —
// WidgetPublishGate skips the wake when a republish differs only in
// `publishedAt` — but the render + persist still cost, so the debounce is
// still yours to do. The payload's `stateRevision` stamp is automatic: the
// bridge bumps it on every Storage write, and the host reconciles a
// publication that never landed.)
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
