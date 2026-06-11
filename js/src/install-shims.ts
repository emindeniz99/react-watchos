// Side-effect module: must be the FIRST import of the bundle entry so the
// globals exist before React's scheduler module captures them at init.
import { installShims } from "./shims";

installShims();
