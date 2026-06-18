// The bundle the watch target evaluates (built by scripts/build-watch.mjs
// into targets/watch/assets/bundle.js). Shims are injected by the build
// preset, so they run before react/scheduler init.
import { runApp } from "react-native-watchos";
import { App } from "./App";

runApp(<App />);
