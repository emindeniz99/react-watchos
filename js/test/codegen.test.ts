import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hostMethods } from "../codegen/schema.mjs";

const jsRoot = join(__dirname, "..");
const appRoot = join(jsRoot, "..", "app");

describe("codegen", () => {
  it("committed generated files are up to date (no drift)", () => {
    // Exits non-zero and prints which file is stale if `npm run codegen`
    // would change anything — the single-source-of-truth guarantee.
    expect(() =>
      execFileSync("node", [join(jsRoot, "codegen/generate.mjs"), "--check"], {
        stdio: "pipe",
      }),
    ).not.toThrow();
  });

  it("both Swift runtimes install exactly their schema host methods", () => {
    const installed = (file: string): Set<string> => {
      const src = readFileSync(file, "utf8");
      const found = new Set<string>();
      for (const m of src.matchAll(/JS_SetPropertyStr\(\s*\w+,\s*host,\s*"(\w+)"/g)) {
        found.add(m[1]);
      }
      return found;
    };
    const watch = installed(join(appRoot, "targets/watch/JSRuntime.swift"));
    const widget = installed(join(appRoot, "targets/widget/IntentRuntime.swift"));

    const expected = (target: string) =>
      new Set(
        hostMethods.filter((m) => m.targets.includes(target)).map((m) => m.name),
      );
    expect([...watch].sort()).toEqual([...expected("watch")].sort());
    expect([...widget].sort()).toEqual([...expected("widget")].sort());
  });
});
