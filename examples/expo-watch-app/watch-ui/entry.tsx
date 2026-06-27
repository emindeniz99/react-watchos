// The bundle the watch target evaluates (built by scripts/build-targets.mjs
// into targets/watch/assets/bundle.js). Shims are injected by the build
// preset, so they run before react/scheduler init.
import { publishWidgets, runApp } from "react-native-watchos";
import { App } from "./App";
import "./widgets"; // register the same widgets the widget extension renders

runApp(<App />);
// Seed the complications so they show data before the first interaction (the
// app owns the "taps" widget's data — see watch-ui/widgets.tsx).
publishWidgets();
