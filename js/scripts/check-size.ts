// CI size budget: builds each minified bundle (ARCH-03: app + widget) to a temp
// file and fails if any exceeds its budget, so a heavy dependency can't silently
// bloat a target. The widget has a tighter budget than the app — it excludes the
// App UI, and that win should stay locked in.

import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { buildOptions, targets } from "./config.ts";

const dir = mkdtempSync(join(tmpdir(), "rnw-size-"));
let failed = false;
for (const target of targets) {
  const outfile = join(dir, `${target.name}.js`);
  await build({
    ...buildOptions({ minify: true, target }),
    outfile,
    logLevel: "silent",
  });
  const kb = statSync(outfile).size / 1024;
  const rounded = kb.toFixed(0);
  if (kb > target.budgetKB) {
    console.error(
      `${target.name} bundle ${rounded} KB exceeds budget ${target.budgetKB} KB (minified).`,
    );
    failed = true;
  } else {
    console.log(
      `${target.name} bundle ${rounded} KB within budget ${target.budgetKB} KB (minified).`,
    );
  }
}
if (failed) process.exit(1);
