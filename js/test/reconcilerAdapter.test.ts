import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DefaultEventPriority,
  DiscreteEventPriority,
  NoEventPriority,
} from "../src/reconcilerAdapter";

// ARCH-14: react-reconciler internals are not a stable public renderer API,
// and the installed typings (@types/react-reconciler@0.33) STILL describe a
// different contract than the pinned runtime (react-reconciler@0.33) — the
// 0.33 typings fixed the instance exports and createContainer's arity but
// kept the HostConfig stale (see docs/reconciler-version-matrix.md for the
// surviving rows). The whole mitigation is ONE adapter file + exact pinned
// versions + the tested matrix. These tests are the upgrade fixtures: they
// fail the moment either half of that story drifts.

const srcDir = join(__dirname, "..", "src");
const ADAPTER = "reconcilerAdapter.ts";
/** Any import/require specifier of the package or its subpaths. */
const RECONCILER_SPECIFIER = /["']react-reconciler(?:\/[^"']*)?["']/;

describe("ARCH-14: the adapter is the only reconciler boundary", () => {
  it("no src module besides the adapter mentions react-reconciler", () => {
    const offenders = readdirSync(srcDir, { recursive: true })
      .map(String)
      .filter((file) => /\.tsx?$/.test(file) && !file.endsWith(ADAPTER))
      .flatMap((file) =>
        readFileSync(join(srcDir, file), "utf8")
          .split("\n")
          .map((line, i) => [`${file}:${i + 1}`, line] as const)
          .filter(([, line]) => RECONCILER_SPECIFIER.test(line)),
      );
    expect(
      offenders,
      `only src/${ADAPTER} may import react-reconciler — everything else ` +
        `consumes its typed surface (ARCH-14). Offending lines:\n` +
        offenders.map(([at, l]) => `  ${at}: ${l.trim()}`).join("\n"),
    ).toEqual([]);
  });

  it("the tested version matrix row is what is actually installed", () => {
    // Exact pins are load-bearing: the adapter's single unsafe cast asserts
    // a contract verified against react-reconciler@0.33.0 specifically. A
    // bump must go through the upgrade procedure in
    // docs/reconciler-version-matrix.md (and add a row), not slide through
    // a range.
    const pkg = JSON.parse(
      readFileSync(join(__dirname, "..", "package.json"), "utf8"),
    ) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      peerDependencies: Record<string, string>;
    };
    expect(pkg.peerDependencies["react-reconciler"]).toBe("0.33.0");
    expect(pkg.devDependencies["react-reconciler"]).toBe("0.33.0");
    expect(pkg.peerDependencies.react).toBe("^19.2.0");
    expect(pkg.dependencies["@types/react-reconciler"]).toBe("^0.33.0");
  });

  it("re-exported priority constants carry the 0.33 runtime values", () => {
    // Pinned to the RUNTIME's lane values — deliberately not the stale
    // @types/react-reconciler literals (Discrete 1, Default 16), which 0.33
    // ships byte-identical to 0.32 and are still wrong. A
    // failure here means the installed reconciler changed its lane
    // encoding: re-verify the adapter per the version-matrix procedure.
    expect(NoEventPriority).toBe(0);
    expect(DiscreteEventPriority).toBe(2);
    expect(DefaultEventPriority).toBe(32);
  });
});
