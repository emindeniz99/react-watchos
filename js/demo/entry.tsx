// Shims first: react/scheduler capture setTimeout & co. at module init.
import "../src/install-shims";
import { publishWidgets, runApp } from "../src/index";
import { registerDemoWidgets } from "./widgets";
import { App } from "./App";

registerDemoWidgets();
runApp(<App />);
// Seed the complications so they show data before any interaction.
publishWidgets();
