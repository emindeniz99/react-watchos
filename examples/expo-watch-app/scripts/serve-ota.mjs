import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { context } from "esbuild";

// Serves the built watch bundle + OTA manifest over HTTP so the watch's "Check
// for update" can fetch them. This is the demo stand-in for production OTA,
// which is just static hosting (CDN/S3) — there's no server code to deploy.
//
//   npm run build:watch                                   # stamps manifest.json
//   npm run ota:serve                                     # terminal A
//   REACT_WATCH_OTA_URL=http://127.0.0.1:8788 npm run build:watch && npm run prebuild
//
// The watch simulator shares the Mac's network, so 127.0.0.1 works. For a
// physical watch use your Mac's LAN IP (OTA_HOST=0.0.0.0 here, that IP there).
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const servedir = join(root, "targets/watch/assets");
const host = process.env.OTA_HOST ?? "127.0.0.1";
const port = Number(process.env.OTA_PORT ?? 8788);

const ctx = await context({});
const { hosts, port: served } = await ctx.serve({ servedir, host, port });
console.log(
  `OTA server: http://${hosts[0] ?? "127.0.0.1"}:${served}/manifest.json`,
);
