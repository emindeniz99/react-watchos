import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hostMethods } from "../codegen/schema.mjs";

const jsRoot = join(__dirname, "..");
const swiftRoot = join(jsRoot, "swift");

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

  it("the Swift runtime installs exactly the schema's direct host methods", () => {
    // One embedding now: ReactWatchRuntime.JSRuntime serves both the watch app
    // and the widget extension (IntentRuntime reuses it), so it must install
    // every DIRECT host method the schema declares. `via:"invoke"` methods are
    // routed through the generic invoke channel, not installed as their own host
    // functions (SD-1), so they're excluded here. Cross-checks codegen <-> Swift.
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
    const expected = new Set(
      hostMethods.filter((m) => m.via !== "invoke").map((m) => m.name),
    );
    expect([...installed].sort()).toEqual([...expected].sort());
  });

  it("the host routes exactly the schema's invoke methods", () => {
    // Each `via:"invoke"` method must have a routing case in ReactWatchHost's
    // onInvoke dispatcher, so the schema and the native router can't drift.
    const src = readFileSync(
      join(swiftRoot, "Sources/ReactWatchHost/ReactWatchHost.swift"),
      "utf8",
    );
    const routed = new Set<string>();
    for (const m of src.matchAll(/case\s+"(\w+)"\s*:/g)) {
      routed.add(m[1] as string);
    }
    for (const m of hostMethods.filter((m) => m.via === "invoke")) {
      expect(routed.has(m.name)).toBe(true);
    }
  });
});
