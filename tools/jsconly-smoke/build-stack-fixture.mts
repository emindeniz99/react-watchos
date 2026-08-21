// EXPERIMENT (see README.md) — builds the SAME throw fixture that the shipped
// stack-position gate uses (js/test/qbc-symbolication.test.ts) with the SAME
// esbuild preset, so both engines can be asked the one question this project
// actually depends on: does a frame out of a minified bundle carry a LINE and
// a COLUMN, and does that column resolve back through the real source map?
//
// The column is the load-bearing half. `js/scripts/symbolicate-core.ts` feeds
// engine positions straight into @jridgewell/trace-mapping, and a source map
// lookup without a column resolves to the start of the minified line — which,
// for a bundle minified onto ONE line, is the first token of the whole file.
// An engine that reports `line` only is an engine on which `pnpm symbolicate`
// returns the same answer for every frame.
//
// Not a copy of the fixture: it imports js/test/fixtures/qbc-throw.entry.tsx
// by path, so if that file moves or changes shape this build fails loudly
// instead of drifting away from the gate it is mirroring.
//
//   node --experimental-strip-types tools/jsconly-smoke/build-stack-fixture.mts
//   -> out/throw-bundle.js and out/throw-bundle.js.map
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { watchBuildOptions } from "../../js/esbuild/preset.mts";

const here = dirname(fileURLToPath(import.meta.url));

// esbuild is a dependency of the `js` workspace package, not of the repo root,
// and ESM resolves a bare specifier from the IMPORTING file's directory — so a
// plain `import { build } from "esbuild"` in tools/ cannot find it however the
// script is invoked. Resolving through js/package.json is the fix that keeps
// this file where the experiment lives (everything under tools/jsconly-smoke/)
// instead of leaking a script into js/ for a build-system detail. preset.mts
// itself imports esbuild as `import type`, so it is erased and does not need
// the same treatment.
const require = createRequire(join(here, "../../js/package.json"));
const { build } = require("esbuild") as typeof import("esbuild");

const outfile = join(here, "out/throw-bundle.js");
mkdirSync(join(here, "out"), { recursive: true });

// minify: true is the SHIPPING shape and the whole reason symbolication exists
// — locals are renamed, so the frames come back as two-letter names and the
// map is the only way back. sourcemap defaults on and writes <outfile>.map as
// esbuild "external" (no sourceMappingURL comment), exactly as the gate does.
await build({
  ...watchBuildOptions({
    entry: join(here, "../../js/test/fixtures/qbc-throw.entry.tsx"),
    outfile,
    minify: true,
  }),
  logLevel: "silent",
});

console.log(outfile);
