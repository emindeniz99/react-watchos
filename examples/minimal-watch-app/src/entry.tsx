// The bundle entry the watch target evaluates. The QuickJS shims are
// prepended by esbuild's `inject` (the build preset wires that), so they run
// before react/scheduler init regardless of import order here.
import { runApp } from "react-native-watchos";
import { App } from "./App";

runApp(<App />);
