import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hostMethods } from "../codegen/schema.mjs";

const jsRoot = join(__dirname, "..");
const swiftRoot = join(jsRoot, "..", "swift");

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

  it("the Swift runtime installs exactly the schema's host methods", () => {
    // One embedding now: ReactWatchRuntime.JSRuntime serves both the watch app
    // and the widget extension (IntentRuntime reuses it), so it must install
    // every host method the schema declares. Cross-checks codegen <-> Swift.
    const src = readFileSync(
      join(swiftRoot, "Sources/ReactWatchRuntime/JSRuntime.swift"),
      "utf8",
    );
    const installed = new Set<string>();
    for (const m of src.matchAll(
      /JS_SetPropertyStr\(\s*\w+,\s*host,\s*"(\w+)"/g,
    )) {
      installed.add(m[1] as string);
    }
    const expected = new Set(hostMethods.map((m) => m.name));
    expect([...installed].sort()).toEqual([...expected].sort());
  });
});
