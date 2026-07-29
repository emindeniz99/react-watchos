import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Metafile } from "esbuild";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { watchBuildOptions } from "../esbuild/preset.mts";
import {
  findDuplicateCopies,
  SINGLE_COPY_PACKAGES,
} from "../esbuild/single-copy.mts";

// The gate that would have caught the dual-React bundle: the renderer's react
// range and a consumer's react range only have to differ by a patch for the
// install to produce two copies, and esbuild bundles both. The reconciler then
// binds the hooks dispatcher to one copy while the app's components read the
// other, so the first useState() reads `null` — a blank watch screen, from a
// build every other gate calls green (tsc sees one @types/react; the example's
// vitest config sets `resolve.dedupe`; `nodePaths` is only a resolution
// fallback). These tests assert on the module graph, which is the only place
// the second copy is visible.

/** A metafile with exactly the given input paths (nothing else is read). */
function inputs(...paths: string[]): Metafile {
  return {
    inputs: Object.fromEntries(
      paths.map((p) => [p, { bytes: 0, imports: [] }]),
    ),
    outputs: {},
  };
}

const PNPM = "../../node_modules/.pnpm";

describe("single-copy guard", () => {
  it("passes a bundle that resolves one react", () => {
    expect(
      findDuplicateCopies(
        inputs(
          `${PNPM}/react@19.2.3/node_modules/react/index.js`,
          `${PNPM}/react@19.2.3/node_modules/react/cjs/react.production.js`,
          `${PNPM}/react-reconciler@0.33.0_react@19.2.3/node_modules/react-reconciler/index.js`,
          "src/index.ts",
        ),
      ),
    ).toEqual([]);
  });

  it("reports both install roots when two reacts land in one bundle", () => {
    // The exact shape of the shipped regression: the renderer resolved
    // react@19.2.8 from its own node_modules while the app resolved its
    // pinned 19.2.3.
    const found = findDuplicateCopies(
      inputs(
        `${PNPM}/react@19.2.8/node_modules/react/index.js`,
        `${PNPM}/react@19.2.3/node_modules/react/index.js`,
        `${PNPM}/react-reconciler@0.33.0_react@19.2.8/node_modules/react-reconciler/index.js`,
      ),
    );
    expect(found).toEqual([
      {
        name: "react",
        roots: [
          `${PNPM}/react@19.2.3/node_modules/react/`,
          `${PNPM}/react@19.2.8/node_modules/react/`,
        ],
      },
    ]);
  });

  it("counts react-reconciler separately from react", () => {
    // `react` must not match inside `react-reconciler`, and a doubled
    // reconciler is its own failure (two reconcilers = two dispatchers).
    const found = findDuplicateCopies(
      inputs(
        `${PNPM}/react-reconciler@0.33.0_react@19.2.3/node_modules/react-reconciler/index.js`,
        `${PNPM}/react-reconciler@0.33.0_react@19.2.8/node_modules/react-reconciler/index.js`,
        `${PNPM}/react@19.2.3/node_modules/react/index.js`,
      ),
    );
    expect(found.map((d) => d.name)).toEqual(["react-reconciler"]);
    expect(SINGLE_COPY_PACKAGES).toEqual(["react", "react-reconciler"]);
  });

  // End-to-end through the published preset, because the wiring is the point:
  // a guard that exists but isn't in every consumer's build path is the same
  // blind spot again. Two real `node_modules/react/` directories, one entry
  // that pulls both, and the build must not produce a bundle.
  const fixture = (copies: string[]): string => {
    const dir = mkdtempSync(join(tmpdir(), "single-copy-"));
    for (const c of copies) {
      mkdirSync(join(dir, c, "node_modules/react"), { recursive: true });
      writeFileSync(
        join(dir, c, "node_modules/react/index.js"),
        `export const copy = ${JSON.stringify(c)};\n`,
      );
    }
    writeFileSync(
      join(dir, "entry.js"),
      `${copies
        .map(
          (c, i) =>
            `import { copy as c${i} } from "./${c}/node_modules/react/index.js";`,
        )
        .join(
          "\n",
        )}\nglobalThis.copies = [${copies.map((_, i) => `c${i}`).join(", ")}];\n`,
    );
    return dir;
  };

  it("fails the build when the preset bundles two copies of react", async () => {
    const dir = fixture(["app", "renderer"]);
    await expect(
      build(
        watchBuildOptions({
          entry: join(dir, "entry.js"),
          outfile: join(dir, "bundle.js"),
        }) as Parameters<typeof build>[0],
      ),
    ).rejects.toThrow(/2 copies of react/);
  });

  it("builds normally when there is only one copy", async () => {
    const dir = fixture(["app"]);
    await expect(
      build(
        watchBuildOptions({
          entry: join(dir, "entry.js"),
          outfile: join(dir, "bundle.js"),
        }) as Parameters<typeof build>[0],
      ),
    ).resolves.toBeTruthy();
  });
});
