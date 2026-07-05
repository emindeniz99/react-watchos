// QuickJS shims are prepended by esbuild's `inject` (scripts/config.ts),
// so they run before module init regardless of import order here.
//
// The WIDGET bundle (ARCH-03): the widget extension evaluates ONLY this to
// handle control intents (`__handleIntent`) and refresh timelines
// (`__renderWidgets`). It deliberately does NOT import App or call runApp, so
// the widget process never evaluates the app UI tree — a smaller bundle and a
// strict capability subset (CX-004). Intent handlers republish timelines via
// publishWidgets internally.
import { registerDemoIntents } from "./intents";
import { registerDemoWidgets } from "./widgets";

registerDemoWidgets();
registerDemoIntents();
