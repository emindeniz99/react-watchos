import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { buildOptions, targets } from "../scripts/config";

/**
 * ARCH-03's real payoff, asserted structurally rather than by byte count.
 *
 * The widget extension renders timelines with the reconciler-free walker
 * (src/staticRender.ts), so react-reconciler + scheduler must contribute
 * NOTHING to the widget bundle — they were 83.8% of it (128,478 B of 153,362 B
 * minified) while `renderToTree` still mounted a fiber tree on a MemoryHost.
 *
 * The check is on what esbuild actually EMITS, not on what it parsed: the
 * barrel (src/index.ts) still re-exports `runApp`/`WatchRoot`, so the widget
 * entry's module graph reaches renderer.ts and tree-shaking is what keeps it
 * out of the output. That makes this the guard that matters — the shake is
 * silent when it stops working (a `sideEffects` entry, a top-level side effect
 * in a new module, a stray value import from src/widgets.ts), and the size
 * budget only notices afterwards, in kilobytes rather than in cause.
 *
 * The app assertion is the other half: the app keeps the real reconciler, so a
 * "fix" that cut it everywhere would break the UI rather than shrink it.
 */
async function bundledFiles(name: string): Promise<string[]> {
  const target = targets.find((t) => t.name === name);
  if (!target) throw new Error(`no such build target: ${name}`);
  const out = join(mkdtempSync(join(tmpdir(), `rnw-graph-${name}-`)), "b.js");
  const result = await build({
    ...buildOptions({ minify: true, target }),
    outfile: out,
    metafile: true,
    logLevel: "silent",
  });
  const emitted = Object.values(result.metafile.outputs).find(
    (output) => output.entryPoint,
  );
  if (!emitted) throw new Error(`no entry output for target: ${name}`);
  return Object.entries(emitted.inputs)
    .filter(([, info]) => info.bytesInOutput > 0)
    .map(([file]) => file);
}

const contributes = (files: string[], pkg: string): boolean =>
  files.some((file) => file.includes(`node_modules/${pkg}/`));

const has = (files: string[], suffix: string): boolean =>
  files.some((file) => file.endsWith(suffix));

describe("widget bundle", () => {
  it("emits no reconciler, scheduler, renderer or adapter byte", async () => {
    const files = await bundledFiles("widget");
    expect(contributes(files, "react-reconciler")).toBe(false);
    expect(contributes(files, "scheduler")).toBe(false);
    expect(has(files, "src/renderer.ts")).toBe(false);
    expect(has(files, "src/reconcilerAdapter.ts")).toBe(false);
    // react itself STAYS: createElement/memo/createContext and the hook
    // dispatcher slot the walker installs all come from it.
    expect(contributes(files, "react")).toBe(true);
    expect(has(files, "src/staticRender.ts")).toBe(true);
  });

  it("leaves the app bundle on the real reconciler", async () => {
    const files = await bundledFiles("app");
    expect(contributes(files, "react-reconciler")).toBe(true);
    expect(has(files, "src/renderer.ts")).toBe(true);
    // Both bundles share ONE renderToTree, so the payload the app publishes and
    // the one the extension re-renders in-process cannot disagree (ARCH-06).
    expect(has(files, "src/staticRender.ts")).toBe(true);
  });
});
