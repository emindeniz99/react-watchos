import { join } from "node:path";
import { context } from "esbuild";
import { buildOptions, root } from "./config.ts";

/**
 * Live-reload dev server. Rebuilds on every source change and serves
 * dist/bundle.js on http://127.0.0.1:8788. In DEBUG builds the watch app
 * polls this URL (WatchApp.swift) and hot-restarts its QuickJS runtime
 * when the bundle changes — edit demo/App.tsx and watch the simulator
 * update. The watch simulator shares the Mac's network, so localhost
 * works out of the box; for a physical watch, bind `DEV_HOST=0.0.0.0`
 * and use your Mac's LAN IP in `REACT_WATCH_OTA_URL`.
 */
const ctx = await context(buildOptions());
await ctx.watch();
const host = process.env.DEV_HOST ?? "127.0.0.1";
const requestedPort = Number(process.env.DEV_PORT ?? 8788);
const { hosts, port } = await ctx.serve({
  servedir: join(root, "dist"),
  host,
  port: requestedPort,
});
console.log(
  `dev server: http://${hosts[0] ?? "127.0.0.1"}:${port}/bundle.js (live reload)`,
);
