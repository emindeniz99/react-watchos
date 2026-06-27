// The WIDGET bundle the watch widget extension evaluates (built by
// scripts/build-targets.mjs into targets/widget/assets/bundle.js). Unlike the
// app bundle (entry.tsx) it does NOT call runApp — it only registers widgets, so
// the extension process stays small and never mounts the app UI. The widgets
// live in ./widgets (shared with the app bundle).
import "./widgets";
