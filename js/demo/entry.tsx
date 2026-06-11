import { installShims } from "../src/shims";
import { runApp } from "../src/index";
import { App } from "./App";

installShims();
runApp(<App />);
