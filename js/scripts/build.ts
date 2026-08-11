import { copyFileSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { build } from "esbuild";
import { bridgeProtocol, hostMethods } from "../codegen/schema.ts";
import { writeOTAManifest } from "../esbuild/manifest.mts";
import { buildOptions, bundleVersion, root, targets } from "./config.ts";
import { unprovidedFeatures } from "./releaseContract.ts";

// `npm run build -- --minify` (or MINIFY=1) roughly halves the bundle;
// unminified keeps watch-side stack traces readable during development.
const minify = process.argv.includes("--minify") || !!process.env.MINIFY;

// Validate the declared capability contract (ARCH-02) before building: a bundle
// must not declare a feature its target's native binary can't provide (a typo,
// or e.g. "network" on the widget target). Fail loud — a wrong contract would
// ship a manifest that mis-gates OTA.
for (const target of targets) {
  const missing = unprovidedFeatures(
    target.requiredFeatures,
    hostMethods,
    target.schemaTarget,
  );
  if (missing.length > 0) {
    throw new Error(
      `[build] ${target.name} bundle declares features its ${target.schemaTarget} ` +
        `binary can't provide: ${missing.join(", ")} (see scripts/config.ts)`,
    );
  }
}

// Build each target's bundle (ARCH-03: app + widget) and ship it to its target.
for (const target of targets) {
  await build(buildOptions({ minify, target }));
  const kb = (statSync(target.outfile).size / 1024).toFixed(0);
  console.log(`${target.name} bundle: ${kb} KB${minify ? " (minified)" : ""}`);

  mkdirSync(dirname(target.asset), { recursive: true });
  copyFileSync(target.outfile, target.asset);
  console.log(`copied ${target.name} bundle to ${target.asset}`);
  // Drop any stale precompiled bytecode beside the source (target dir + dist):
  // a JS-only build must never ship a .qbc out of sync with this fresh source.
  // `build:bytecode` regenerates it (+ its bundle.hash content-hash stamp,
  // OP-1) from the bundle (vendored quickjs-ng).
  rmSync(target.asset.replace(/bundle\.js$/, "bundle.qbc"), { force: true });
  rmSync(target.outfile.replace(/\.js$/, ".qbc"), { force: true });
  rmSync(target.asset.replace(/bundle\.js$/, "bundle.hash"), { force: true });
  rmSync(target.outfile.replace(/\.js$/, ".hash"), { force: true });
}

// OTA manifest (CR-17): the freshness check fetches this. It ships the APP
// bundle (the app is what runs OTA); `bundle` is relative so it resolves against
// wherever the manifest is served (the dev server serves dist/ statically, so
// /manifest.json + /bundle.js). `signature` is null here — sign at publish time
// with `ota:sign`. Uses the SAME published helper a consumer's build uses
// (react-watchos/manifest): it computes `releaseId` (CX-025 freshness)
// and stamps `requiredFeatures`/`minBridgeProtocol` (ARCH-02 capability gate).
const manifest = writeOTAManifest({
  distDir: join(root, "dist"),
  version: bundleVersion,
  requiredFeatures: targets[0].requiredFeatures,
  minBridgeProtocol: bridgeProtocol,
});
console.log(
  `manifest: version ${manifest.version}, releaseId ${manifest.releaseId}, ` +
    `features [${manifest.requiredFeatures.join(", ")}]`,
);
