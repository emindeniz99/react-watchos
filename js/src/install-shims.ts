// Side-effect module: must be the FIRST import of the bundle entry so the
// globals exist before React's scheduler module captures them at init.
// esbuild's `inject` (esbuild/preset.mts) is what guarantees that, not import
// order in the entry file.
import { installFetch } from "./fetch";
import type { QuickJSHostGlobal } from "./host";
import { installShims } from "./shims";

installShims();

// The network shims (fetch/Headers/AbortController) are a BUILD-TIME choice,
// not a runtime one. This module is injected into EVERY bundle, so whatever it
// touches is bundled unconditionally — which is how a widget bundle whose
// declared contract is ["storage","widgets"] ended up carrying 3,711 B of a
// fetch it can never call. The preset always `define`s this, to "1" or "":
// esbuild folds the empty case away, and ./fetch then tree-shakes out of the
// bundle entirely. A runtime `if` would save zero bytes, which is the whole
// point. Gating from here (rather than injecting a second module) keeps ONE
// first-thing-to-run entry point, and measured ~262 B smaller than two.
if (process.env.REACT_WATCH_NET) {
  installFetch(
    globalThis as Record<string, unknown> & { __host?: QuickJSHostGlobal },
  );
}
