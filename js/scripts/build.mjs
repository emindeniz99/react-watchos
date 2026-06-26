import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { build } from "esbuild";
import { bridgeProtocol, hostMethods } from "../codegen/schema.mjs";
import { buildOptions, bundleVersion, root, targets } from "./config.mjs";
import { contentHash } from "./contentHash.mjs";
import { unprovidedFeatures } from "./releaseContract.mjs";

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
        `binary can't provide: ${missing.join(", ")} (see scripts/config.mjs)`,
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
  // `build:bytecode` regenerates it from the bundle (vendored quickjs-ng).
  rmSync(target.asset.replace(/bundle\.js$/, "bundle.qbc"), { force: true });
  rmSync(target.outfile.replace(/\.js$/, ".qbc"), { force: true });
}

// OTA manifest (CR-17): the freshness check fetches this. It ships the APP
// bundle (the app is what runs OTA); `bundle` is relative so it resolves against
// wherever the manifest is served (the dev server serves dist/ statically, so
// /manifest.json + /bundle.js). `signature` is null here — sign
// "v1:<kid>:<version>:<bundle>" at publish time with your Ed25519 key and fill
// it in; unsigned bundles load only in fail-open.
//
// `releaseId` (CX-025) is the content hash of the app bundle — the *freshness*
// signal, distinct from `version` (the rollback gate). It's how a non-breaking
// fix (same `version`, different content) is detected as an available update;
// it matches the host's `__bundleReleaseId` for the same bytes.
//
// `requiredFeatures`/`minBridgeProtocol` (ARCH-02) are the app bundle's declared
// capability contract: checkForUpdate/fetchAndApplyUpdate read them to refuse
// applying a bundle this binary can't run (OTA can't add native code) — stamped
// here so the publisher doesn't hand-pass them.
const releaseId = contentHash(readFileSync(targets[0].outfile, "utf8"));
writeFileSync(
  join(root, "dist/manifest.json"),
  `${JSON.stringify(
    {
      version: bundleVersion,
      bundle: "bundle.js",
      signature: null,
      releaseId,
      requiredFeatures: targets[0].requiredFeatures,
      minBridgeProtocol: bridgeProtocol,
    },
    null,
    2,
  )}\n`,
);
console.log(
  `manifest: version ${bundleVersion}, releaseId ${releaseId}, ` +
    `features [${targets[0].requiredFeatures.join(", ")}]`,
);
