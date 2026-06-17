// CI size budget: builds the minified bundle to a temp file and fails if it
// exceeds the budget, so a heavy dependency can't silently bloat the app.
// Current minified size is ~143 KB; the budget gives headroom for React
// point bumps but catches large regressions.

import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { buildOptions } from "./config.mjs";

const BUDGET_KB = 200;

const outfile = join(mkdtempSync(join(tmpdir(), "rnw-size-")), "bundle.js");
await build({ ...buildOptions({ minify: true }), outfile, logLevel: "silent" });

const kb = statSync(outfile).size / 1024;
const rounded = kb.toFixed(0);
if (kb > BUDGET_KB) {
  console.error(
    `bundle ${rounded} KB exceeds budget ${BUDGET_KB} KB (minified).`,
  );
  process.exit(1);
}
console.log(`bundle ${rounded} KB within budget ${BUDGET_KB} KB (minified).`);
